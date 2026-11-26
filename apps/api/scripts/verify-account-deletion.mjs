// Account deletion and display-name change (foundations plan 3, migration 028).
//
// Deleting an account removes the person and keeps their work as from a
// deleted account; an owner must hand off or archive their projects; strikes
// survive against a hash of the email; leases they held go back to the pool
// (deletion waits while one of their submissions is being checked).
//
// Needs the API (RATE_LIMITS=off) on a throwaway database with matchd running
// (one submission is checked), and that database's URL.
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   node apps/api/scripts/verify-account-deletion.mjs
import { execFileSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import pg from "pg"

const API = process.env.AUDIT_API ?? "http://localhost:3100/v1"
const DATABASE_URL = process.env.AUDIT_DATABASE_URL
if (!DATABASE_URL) throw new Error("Set AUDIT_DATABASE_URL to the throwaway database.")
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const fixture = JSON.parse(readFileSync(path.join(root, "fixtures/link/export.json"), "utf8"))
const db = new pg.Client({ connectionString: DATABASE_URL })
await db.connect()

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
}
const call = async (method, p, token, body) => {
  const send = () => fetch(`${API}${p}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  // The admin command runs between requests for longer than the server keeps
  // an idle connection, so the first request after it can hit a closed socket.
  const res = await send().catch((error) => {
    if (error?.cause?.code === "ECONNRESET") return send()
    throw error
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, body: json }
}
const ok = (s) => s >= 200 && s < 300
const show = (r) => `${r.status}${r.body?.reason ? ` ${r.body.reason}` : ""}${r.body?.detail ? `: ${r.body.detail}` : ""}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tag = () => randomBytes(3).toString("hex")
const adminCommand = (...args) =>
  execFileSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "apps/api/src/db/admin.ts"), ...args], {
    cwd: path.join(root, "apps/api"), env: { ...process.env, DATABASE_URL }, stdio: "pipe", encoding: "utf8"
  })
const signUp = async (label, email = `audit-del-${label}-${tag()}@example.test`) => {
  const account = { email, displayName: `Del ${label} ${tag()}`, password: randomBytes(18).toString("base64url") }
  const res = await call("POST", "/auth/sign-up", undefined, { ...account, acceptPolicy: true })
  if (!ok(res.status)) throw new Error(`sign-up failed: ${show(res)}`)
  return { ...account, token: res.body.token, id: res.body.user.id }
}
const newProject = async (owner, label) => {
  const slug = `del-${label}-${tag()}`
  const created = await call("POST", "/projects", owner.token, {
    slug, name: `Deletion ${label} ${slug}`, homeRegion: "us-east-1", language: fixture.language, toolchain: fixture.toolchain
  })
  if (!ok(created.status)) throw new Error(`project create failed: ${show(created)}`)
  const imported = await call("POST", `/projects/${slug}/imports?rightsConfirmed=true`, owner.token, fixture)
  if (!ok(imported.status)) throw new Error(`import failed: ${show(imported)}`)
  return { slug, name: created.body.name ?? `Deletion ${label} ${slug}` }
}
const chunkByName = async (slug, name) =>
  (await call("GET", `/projects/${slug}/chunks`)).body.find((c) => c.name === name)

const person = await signUp("person")
const other = await signUp("other")
const admin = await signUp("admin")
adminCommand("grant", admin.email)

// --- Display name
const renamed = await call("PATCH", "/auth/me", person.token, { displayName: "  Renamed Person  " })
check("a display name can be changed (trimmed)", ok(renamed.status) && renamed.body.displayName === "Renamed Person", show(renamed))
const blank = await call("PATCH", "/auth/me", person.token, { displayName: "   " })
check("a blank display name is refused", blank.status === 400, show(blank))
const tooLong = await call("PATCH", "/auth/me", person.token, { displayName: "x".repeat(81) })
check("a display name over 80 characters is refused", tooLong.status === 400, show(tooLong))
const work = (await call("POST", "/auth/tokens", person.token, { label: "agent" })).body.token
const workRename = await call("PATCH", "/auth/me", work, { displayName: "Agent" })
const workDelete = await call("POST", "/auth/delete-account", work, { password: person.password })
check("a work token can change neither the name nor delete the account",
  workRename.status === 403 && workDelete.status === 403, `${show(workRename)} | ${show(workDelete)}`)
const full = (await call("POST", "/auth/tokens", person.token, { label: "laptop", scope: "all" })).body.token

// --- Things the deletion has to deal with
const owned = await newProject(person, "owned")
const theirs = await newProject(other, "theirs")
await call("POST", `/users/${other.id}/follow`, person.token)
const thread = await call("POST", `/projects/${theirs.slug}/threads`, person.token, { title: "Hello", body: "from someone who will leave" })
const leaf = await chunkByName(theirs.slug, "leaf")
const caller = await chunkByName(theirs.slug, "caller")
const leafLease = await call("POST", `/projects/${theirs.slug}/chunks/${leaf.id}/checkout`, person.token)
const submitted = await call("POST", `/projects/${theirs.slug}/chunks/${leaf.id}/submit`, person.token, {
  leaseToken: leafLease.body?.leaseToken, source: "int leaf(int x) { return x + 12345; }\n"
})
const callerLease = await call("POST", `/projects/${theirs.slug}/chunks/${caller.id}/checkout`, person.token)
check("set-up: a thread, a submission, and a held lease",
  ok(thread.status) && ok(submitted.status) && ok(callerLease.status), `${show(thread)} | ${show(submitted)} | ${show(callerLease)}`)
const strike = await call("POST", `/admin/users/${person.id}/strikes`, admin.token, { note: "A notice that stood." })
check("set-up: the account has a strike", ok(strike.status), show(strike))

// --- Refusals
const wrong = await call("POST", "/auth/delete-account", person.token, { password: "not the password" })
check("a wrong password is refused", wrong.status === 400 && /password-rejected$/.test(wrong.body?.type ?? ""), show(wrong))
const owns = await call("POST", "/auth/delete-account", person.token, { password: person.password })
check("an owner is refused and told which projects",
  owns.status === 409 && owns.body?.reason === "owns_projects" && owns.body.detail.includes(owned.slug), show(owns))
const stillThere = await call("GET", "/auth/me", person.token)
check("a refused deletion changes nothing", ok(stillThere.status), show(stillThere))

// --- Deleting (refused while the submission on leaf is still being checked)
let gone
let sawChecking = false
for (let i = 0; i < 60; i++) {
  gone = await call("POST", "/auth/delete-account", person.token, { password: person.password, archiveOwnedProjects: true })
  if (gone.status !== 409 || gone.body?.reason !== "submission_checking") break
  sawChecking = true
  await sleep(1000)
}
check("the owner can delete, archiving their projects",
  ok(gone.status) && gone.body.archivedProjects.length === 1 && gone.body.archivedProjects[0].slug === owned.slug, show(gone))
if (sawChecking) console.log("  (deletion waited for the submission to be checked)")

const sessionAfter = await call("GET", "/auth/me", person.token)
const tokenAfter = await call("GET", "/auth/me", full)
const signInAfter = await call("POST", "/auth/sign-in", undefined, { email: person.email, password: person.password })
check("the session, the tokens, and the password stop working",
  sessionAfter.status === 401 && tokenAfter.status === 401 && signInAfter.status === 401,
  `${sessionAfter.status}/${tokenAfter.status}/${signInAfter.status}`)
const profileAfter = await call("GET", `/users/${person.id}`)
check("the profile is gone", profileAfter.status === 404, show(profileAfter))
const otherProfile = await call("GET", `/users/${other.id}`)
check("their follows are gone", otherProfile.body?.followerCount === 0, `${otherProfile.body?.followerCount}`)
const threadAfter = await call("GET", `/projects/${theirs.slug}/threads/${thread.body.thread.id}`)
check("their thread stays, from a deleted account",
  ok(threadAfter.status) && threadAfter.body.thread.authorId === null && threadAfter.body.thread.authorName === null, show(threadAfter))
const attemptsAfter = await call("GET", `/projects/${theirs.slug}/chunks/${leaf.id}/attempts`)
const attempt = attemptsAfter.body?.find?.((a) => a.id === submitted.body.attemptId)
check("their attempt stays, from a deleted account",
  attempt !== undefined && attempt.userId === null && attempt.displayName === null, show(attemptsAfter))

const archived = (await db.query("SELECT archived_at FROM projects WHERE slug = $1", [owned.slug])).rows[0]
const ownerRows = (await db.query(
  "SELECT count(*)::int AS n FROM project_members m JOIN projects p ON p.id = m.project_id WHERE p.slug = $1", [owned.slug]
)).rows[0]
check("the owned project is archived and has no members", archived?.archived_at !== null && ownerRows.n === 0)
const record = (await db.query(
  `SELECT a.note FROM moderation_actions a JOIN projects p ON p.id = a.project_id
   WHERE p.slug = $1 AND a.kind = 'archive_project' AND a.admin_id IS NULL`, [owned.slug]
)).rows
check("the archive is in the admins' record", record.length === 1, JSON.stringify(record))
const restore = await call("POST", `/admin/projects/${owned.slug}/restore`, admin.token, { note: "Asked to restore." })
check("an ownerless project cannot be restored", restore.status === 409 && /no owner/.test(restore.body?.detail ?? ""), show(restore))

const hash = createHash("sha256").update(person.email.toLowerCase()).digest()
const kept = (await db.query("SELECT user_id, email_hash FROM strikes WHERE email_hash = $1", [hash])).rows
check("the strike is kept against a hash of the email", kept.length === 1 && kept[0].user_id === null)
const leftovers = (await db.query(
  `SELECT (SELECT count(*) FROM sessions WHERE user_id = $1)
        + (SELECT count(*) FROM access_tokens WHERE user_id = $1)
        + (SELECT count(*) FROM follows WHERE follower_id = $1)
        + (SELECT count(*) FROM users WHERE id = $1) AS n`, [person.id]
)).rows[0]
check("no personal rows are left", Number(leftovers.n) === 0, `${leftovers.n}`)

// --- Leases go back to the pool at once, and the board counts follow
const rows = (await db.query("SELECT id, state, lease_user_id FROM chunks WHERE id = ANY($1)", [[leaf.id, caller.id]])).rows
const states = Object.fromEntries(rows.map((r) => [r.id === leaf.id ? "leaf" : "caller", r.state]))
check("the chunks they held go back to the pool", states.leaf === "open" && states.caller === "open", JSON.stringify(states))
const sideLeases = (await db.query(
  "SELECT count(*)::int AS n FROM chunk_leases WHERE chunk_id = ANY($1) AND released_at IS NULL", [[leaf.id, caller.id]]
)).rows[0]
check("no leases on those chunks are left open", sideLeases.n === 0, `${sideLeases.n}`)
const counts = (await db.query(
  "SELECT s.leased_count, s.validating_count FROM project_chunk_stats s JOIN projects p ON p.id = s.project_id WHERE p.slug = $1",
  [theirs.slug]
)).rows[0]
check("the project's chunk counts are refreshed", counts?.leased_count === 0 && counts?.validating_count === 0, JSON.stringify(counts))

// --- Signing up again with the same email brings the strike back
const again = await signUp("again", person.email)
const strikesAgain = await call("GET", `/admin/users/${again.id}/strikes`, admin.token)
check("a new account with that email takes the strike back",
  ok(strikesAgain.status) && strikesAgain.body.length === 1, show(strikesAgain))

// --- The admin command, for requests by email
const suspended = await signUp("suspended")
await call("POST", `/admin/users/${suspended.id}/suspend`, admin.token, { note: "Abuse." })
let refusedOutput = ""
try {
  adminCommand("delete-user", suspended.email)
} catch (error) {
  refusedOutput = `${error.stderr ?? ""}`
}
const suspendedStill = (await db.query("SELECT 1 FROM users WHERE id = $1", [suspended.id])).rows.length
check("the admin command refuses a suspended account", suspendedStill === 1 && /suspended/.test(refusedOutput), refusedOutput.trim())

const byEmail = await signUp("by-email")
const byEmailProject = await newProject(byEmail, "by-email")
let ownerOutput = ""
try {
  adminCommand("delete-user", byEmail.email)
} catch (error) {
  ownerOutput = `${error.stderr ?? ""}`
}
check("the admin command refuses an owner without --archive-projects", /--archive-projects/.test(ownerOutput), ownerOutput.trim())
const done = adminCommand("delete-user", byEmail.email, "--archive-projects")
const byEmailSignIn = await call("POST", "/auth/sign-in", undefined, { email: byEmail.email, password: byEmail.password })
check("the admin command deletes on a request by email",
  byEmailSignIn.status === 401 && done.includes(byEmailProject.slug), `${byEmailSignIn.status} ${done.trim()}`)

await db.end()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
