// Content policy enforcement: policy agreement at sign-up, rights
// confirmation on import, reports, and what a site admin can do about them.
//
// Needs the API (RATE_LIMITS=off) on a throwaway database and that
// database's URL. The first admin is granted with the admin command, the
// same way an operator would.
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   node apps/api/scripts/verify-moderation.mjs
import { execFileSync } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const pg = require("pg")
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
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, body: json }
}
const ok = (s) => s >= 200 && s < 300
const detail = (r) => `${r.status}${r.body?.detail ? `: ${r.body.detail}` : ""}`
// The admin command, run the way `npm run api:admin` runs it, without a shell.
const adminCommand = (...args) =>
  execFileSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "apps/api/src/db/admin.ts"), ...args], {
    cwd: path.join(root, "apps/api"), env: { ...process.env, DATABASE_URL }, stdio: "ignore"
  })
const tag = () => randomBytes(3).toString("hex")
const newAccount = (label) => ({
  email: `audit-mod-${label}-${tag()}@example.test`,
  displayName: `Mod ${label} ${tag()}`,
  password: randomBytes(18).toString("base64url")
})
const signUp = async (label) => {
  const account = newAccount(label)
  const res = await call("POST", "/auth/sign-up", undefined, { ...account, acceptPolicy: true })
  if (!ok(res.status)) throw new Error(`sign-up failed: ${detail(res)}`)
  return { ...account, token: res.body.token, id: res.body.user.id, user: res.body.user }
}

// --- Agreeing to the policy.
const noPolicy = await call("POST", "/auth/sign-up", undefined, newAccount("nopolicy"))
check("sign-up without agreeing to the content policy is refused",
  noPolicy.status === 400 && /content policy/.test(noPolicy.body?.detail ?? ""), detail(noPolicy))
const owner = await signUp("owner")
const stored = (await db.query("SELECT policy_version, policy_accepted_at FROM users WHERE id = $1", [owner.id])).rows[0]
check("sign-up records which policy was accepted and when",
  typeof stored?.policy_version === "string" && stored.policy_version.length > 0 && stored.policy_accepted_at !== null,
  JSON.stringify(stored))
check("a new account is not an admin", owner.user.isAdmin === false)

// --- Confirming rights on import.
const slug = `mod-${tag()}`
const P = `/projects/${slug}`
await call("POST", "/projects", owner.token, {
  slug, name: "Moderation", homeRegion: "us-east-1", language: fixture.language, toolchain: fixture.toolchain
})
const unconfirmed = await call("POST", `${P}/imports`, owner.token, fixture)
check("an import without the rights confirmation is refused, saying what to confirm",
  unconfirmed.status === 400 && /own a copy/.test(unconfirmed.body?.detail ?? ""), detail(unconfirmed))
// A program no earlier run has seen, so nothing could already be stored under its hash.
const program = randomBytes(4096)
const programSha = createHash("sha256").update(program).digest("hex")
const withBinary = await call("POST", `${P}/imports?rightsConfirmed=true`, owner.token, {
  ...fixture, binarySha256: programSha, binaryBase64: program.toString("base64")
})
const storedBinary = await db.query("SELECT 1 FROM blobs WHERE sha256 = decode($1, 'hex')", [programSha])
check("an import carrying the whole program is refused, and nothing of it is stored",
  withBinary.status === 400 && /binaryBase64/.test(withBinary.body?.detail ?? "") && storedBinary.rows.length === 0,
  `${detail(withBinary)} blobRows=${storedBinary.rows.length}`)
const imported = await call("POST", `${P}/imports?rightsConfirmed=true`, owner.token, fixture)
const importRow = (await db.query("SELECT rights_confirmed_at, rights_confirmed_by FROM imports WHERE id = $1", [imported.body?.id])).rows[0]
check("a confirmed import goes through and records who confirmed",
  ok(imported.status) && importRow?.rights_confirmed_by === owner.id && importRow?.rights_confirmed_at !== null, detail(imported))

// --- Reports.
const reporter = await signUp("reporter")
const board = (await call("GET", `${P}/chunks`)).body
const leaf = board.find((c) => c.name === "leaf")
const thread = await call("POST", `${P}/threads`, owner.token, { title: "Hello", body: "a post someone will report" })
const postId = thread.body?.posts?.[0]?.id
const anon = await call("POST", "/reports", undefined, { projectSlug: slug, reason: "other", body: "x" })
check("reporting needs a signed-in user", anon.status === 401, detail(anon))
const r1 = await call("POST", "/reports", reporter.token, { projectSlug: slug, reason: "copyright", body: "This is my company's game." })
const r2 = await call("POST", "/reports", reporter.token, { projectSlug: slug, chunkId: leaf.id, reason: "malware", body: "Looks like a dropper." })
const r3 = await call("POST", "/reports", reporter.token, { projectSlug: slug, postId, reason: "abuse", body: "Harassment." })
check("a project, a function, and a post can each be reported",
  r1.status === 201 && r2.status === 201 && r3.status === 201, `${detail(r1)} ${detail(r2)} ${detail(r3)}`)
const otherSlug = `mod-other-${tag()}`
await call("POST", "/projects", owner.token, {
  slug: otherSlug, name: "Other", homeRegion: "us-east-1", language: fixture.language, toolchain: fixture.toolchain
})
const wrongChunk = await call("POST", "/reports", reporter.token, { projectSlug: otherSlug, chunkId: leaf.id, reason: "other", body: "x" })
check("a report naming a function from another project is refused", wrongChunk.status === 400, detail(wrongChunk))
const noProject = await call("POST", "/reports", reporter.token, { projectSlug: `none-${tag()}`, reason: "other", body: "x" })
check("a report on a project that does not exist is 404", noProject.status === 404, detail(noProject))

// --- Admin access.
const notAdmin = await call("GET", "/admin/reports", reporter.token)
check("someone who is not an admin gets 403 from the admin endpoints", notAdmin.status === 403, detail(notAdmin))
const admin = await signUp("admin")
adminCommand("grant", admin.email)
const me = await call("GET", "/auth/me", admin.token)
check("the admin command grants admin, and the same session sees it at once", me.body?.isAdmin === true, JSON.stringify(me.body))

const queue = await call("GET", "/admin/reports", admin.token)
const mine = (queue.body ?? []).filter((r) => r.project.slug === slug)
const onPost = mine.find((r) => r.reason === "abuse")
check("the admin queue lists open reports with their project, function, post, and reporter",
  mine.length === 3 &&
    mine.some((r) => r.chunk?.name === "leaf") &&
    onPost?.post?.excerpt === "a post someone will report" &&
    mine.every((r) => r.reporter?.id === reporter.id),
  `${mine.length} for this project`)

// --- Removing a post.
const blank = await call("POST", `/admin/posts/${postId}/remove`, admin.token, { note: "   " })
check("an action without a real note is refused", blank.status === 409, detail(blank))
const removed = await call("POST", `/admin/posts/${postId}/remove`, admin.token, { note: "Harassment, report " + r3.body.id })
const threadAfter = await call("GET", `${P}/threads/${thread.body.thread.id}`)
check("an admin removes a post; it keeps its place with the text hidden",
  removed.status === 204 && threadAfter.body?.posts?.[0]?.deleted === true && threadAfter.body.posts[0].body === "", detail(removed))
const resolved = await call("POST", `/admin/reports/${r3.body.id}/resolve`, admin.token, { resolution: "Post removed." })
check("resolving a report records who resolved it and how",
  ok(resolved.status) && resolved.body.resolvedBy?.id === admin.id && resolved.body.resolution === "Post removed.", detail(resolved))
const again = await call("POST", `/admin/reports/${r3.body.id}/resolve`, admin.token, { resolution: "again" })
check("a resolved report cannot be resolved again", again.status === 409, detail(again))

// --- Archiving a project.
const archived = await call("POST", `/admin/projects/${slug}/archive`, admin.token, { note: "DMCA notice received 2026-11-25 from Example Corp." })
const gone = await call("GET", P)
const boardGone = await call("GET", `${P}/chunks`)
const checkoutGone = await call("POST", `${P}/chunks/${leaf.id}/checkout`, reporter.token)
check("archiving takes the project, its board, and checkouts down",
  ok(archived.status) && archived.body.archivedAt !== null && gone.status === 404 && boardGone.status === 404 && !ok(checkoutGone.status),
  `${detail(archived)} project=${gone.status} board=${boardGone.status} checkout=${checkoutGone.status}`)
const found = await call("GET", `/admin/projects?q=${slug}`, admin.token)
check("admins still find an archived project", found.body?.some?.((p) => p.slug === slug && p.archivedAt !== null && p.openReports === 2), JSON.stringify(found.body?.[0]))
const twice = await call("POST", `/admin/projects/${slug}/archive`, admin.token, { note: "again" })
check("archiving twice is refused", twice.status === 409, detail(twice))
const restored = await call("POST", `/admin/projects/${slug}/restore`, admin.token, { note: "Counter-notice accepted." })
check("restoring brings the project back", ok(restored.status) && (await call("GET", P)).status === 200, detail(restored))

// --- Suspending an account.
const self = await call("POST", `/admin/users/${admin.id}/suspend`, admin.token, { note: "test" })
check("an admin cannot suspend their own account", self.status === 409, detail(self))
const users = await call("GET", `/admin/users?q=${encodeURIComponent(reporter.email)}`, admin.token)
check("admins find accounts by email", users.body?.length === 1 && users.body[0].id === reporter.id, detail(users))
const suspended = await call("POST", `/admin/users/${reporter.id}/suspend`, admin.token, { note: "Repeated abuse." })
const oldSession = await call("GET", "/auth/me", reporter.token)
const signIn = await call("POST", "/auth/sign-in", undefined, { email: reporter.email, password: reporter.password })
check("a suspended account is signed out everywhere and cannot sign in",
  ok(suspended.status) && suspended.body.suspendedAt !== null && oldSession.status === 401 &&
    signIn.status === 403 && /suspended/.test(signIn.body?.detail ?? ""),
  `${detail(suspended)} me=${oldSession.status} signIn=${detail(signIn)}`)
const back = await call("POST", `/admin/users/${reporter.id}/restore`, admin.token, { note: "Appeal upheld." })
const signInAgain = await call("POST", "/auth/sign-in", undefined, { email: reporter.email, password: reporter.password })
check("a restored account can sign in again", ok(back.status) && ok(signInAgain.status), `${detail(back)} ${detail(signInAgain)}`)

// --- The record.
const log = await call("GET", "/admin/actions?limit=50", admin.token)
const kinds = new Set((log.body ?? []).filter((a) => a.admin?.id === admin.id || a.user?.id === admin.id).map((a) => a.kind))
check("every action is in the record with its note",
  ["grant_admin", "remove_post", "resolve_report", "archive_project", "restore_project", "suspend_user", "restore_user"].every((k) => kinds.has(k)) &&
    (log.body ?? []).some((a) => a.kind === "archive_project" && a.note.startsWith("DMCA notice")),
  [...kinds].join(","))
adminCommand("revoke", admin.email)
const revoked = await call("GET", "/admin/reports", admin.token)
check("revoking admin takes effect on the next request", revoked.status === 403, detail(revoked))

await db.end()
const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
