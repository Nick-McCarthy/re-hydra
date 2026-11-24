// End-to-end checks for audit A-012 (open vs members-only projects, blocks).
//
// Needs an API with RATE_LIMITS=off on a throwaway seeded database. Creates
// one project (sample fixture) owned by the dev user and two test accounts.
//
//   AUDIT_API=http://localhost:3100/v1 node apps/api/scripts/verify-access.mjs
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const API = process.env.AUDIT_API ?? "http://localhost:3100/v1"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const sample = JSON.parse(readFileSync(path.join(root, "fixtures/sample/export.json"), "utf8"))

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
const signUp = async (label) => {
  const name = `Access ${label} ${randomBytes(2).toString("hex")}`
  const res = await call("POST", "/auth/sign-up", undefined, {
    email: `audit-access-${label}-${randomBytes(3).toString("hex")}@example.test`, displayName: name, password: randomBytes(18).toString("base64url")
  })
  if (!ok(res.status)) throw new Error(`sign-up failed: ${res.status}`)
  return { token: res.body.token, id: res.body.user.id, name }
}

const owner = (await call("POST", "/auth/sign-in", undefined, { email: "dev@re-hydra.local", password: "rehydra-dev" })).body.token
const outsider = await signUp("outsider")
const other = await signUp("other")
const slug = `access-${randomBytes(3).toString("hex")}`
const created = await call("POST", "/projects", owner, {
  slug, name: "Access check", homeRegion: "us-east-1", language: "c",
  toolchain: { compiler: "gcc", version: "4.8.5", flags: ["-O2"], image: "ghcr.io/re-hydra/gcc:4.8.5@sha256:dev" }
})
if (created.status !== 201) throw new Error(`project create failed: ${detail(created)}`)
check("a new project is open by default", created.body.checkoutPolicy === "open", created.body.checkoutPolicy)
await call("POST", `/projects/${slug}/imports`, owner, sample)
const chunks = (await call("GET", `/projects/${slug}/chunks`)).body
const [c1, c2, c3] = chunks

// --- Open project: any signed-in user may work and propose.
const lease1 = await call("POST", `/projects/${slug}/chunks/${c1.id}/checkout`, outsider.token)
check("open: an outsider can check out", ok(lease1.status), detail(lease1))
const proposal = await call("POST", `/projects/${slug}/type-proposals`, outsider.token, { title: "outsider proposal", headers: "typedef int s32;\n" })
check("open: an outsider can propose types (needed the contributor role before)", ok(proposal.status), detail(proposal))

// --- Members only.
const toMembers = await call("PATCH", `/projects/${slug}/settings`, owner, { checkoutPolicy: "members" })
check("the owner can switch to members only", ok(toMembers.status) && toMembers.body.checkoutPolicy === "members", detail(toMembers))
const hb = await call("POST", `/projects/${slug}/chunks/${c1.id}/heartbeat`, outsider.token, { leaseToken: lease1.body.leaseToken })
const sub = await call("POST", `/projects/${slug}/chunks/${c1.id}/submit`, outsider.token, { leaseToken: lease1.body.leaseToken, source: "int x;\n" })
const co = await call("POST", `/projects/${slug}/chunks/${c2.id}/checkout`, outsider.token)
const pr = await call("POST", `/projects/${slug}/type-proposals`, outsider.token, { title: "second", headers: "typedef int s32;\n" })
check("members only: an outsider's heartbeat, submit, checkout, and proposal are refused",
  [hb, sub, co, pr].every((r) => r.status === 403 && /members only/.test(r.body?.detail ?? "")),
  [hb, sub, co, pr].map((r) => r.status).join(","))
const ownerCo = await call("POST", `/projects/${slug}/chunks/${c2.id}/checkout`, owner)
check("members only: the owner can still check out", ok(ownerCo.status), detail(ownerCo))
await call("POST", `/projects/${slug}/chunks/${c2.id}/release`, owner, { leaseToken: ownerCo.body.leaseToken })
await call("PATCH", `/projects/${slug}/settings`, owner, { checkoutPolicy: "open" })

// --- Blocking.
const notMaintainer = await call("POST", `/projects/${slug}/blocks`, other.token, { userId: outsider.id })
check("a non-maintainer cannot block", notMaintainer.status === 403, detail(notMaintainer))
const ownerSelf = await call("GET", "/auth/me", owner)
const blockOwner = await call("POST", `/projects/${slug}/blocks`, owner, { userId: ownerSelf.body.id })
check("the owner cannot be blocked", blockOwner.status === 403, detail(blockOwner))
const held = await call("POST", `/projects/${slug}/chunks/${c3.id}/checkout`, outsider.token)
const blocked = await call("POST", `/projects/${slug}/blocks`, owner, { userId: outsider.id, reason: "lease hoarding" })
check("an owner can block, and the list shows the reason",
  ok(blocked.status) && blocked.body.some((b) => b.userId === outsider.id && b.reason === "lease hoarding"), detail(blocked))
const c3After = (await call("GET", `/projects/${slug}/chunks/${c3.id}`)).body
const c1After = (await call("GET", `/projects/${slug}/chunks/${c1.id}`)).body
check("blocking ends the blocked user's leases on the project", ok(held.status) && c3After.state === "open" && c1After.state === "open",
  `${c3.name} ${c3After.state}, ${c1.name} ${c1After.state}`)
const coBlocked = await call("POST", `/projects/${slug}/chunks/${c2.id}/checkout`, outsider.token)
const prBlocked = await call("POST", `/projects/${slug}/type-proposals`, outsider.token, { title: "blocked", headers: "typedef int s32;\n" })
check("a blocked user cannot check out or propose, even on an open project",
  coBlocked.status === 403 && /blocked/.test(coBlocked.body?.detail ?? "") && prBlocked.status === 403, `${detail(coBlocked)} | ${prBlocked.status}`)
// The outsider's own checkouts name them as the actor; only the block entry must not.
const feed = (await call("GET", `/projects/${slug}/activity`)).body
const blockEvent = feed.find((e) => e.summary === "A user was blocked from this project")
check("the public activity feed records the block without naming the user",
  blockEvent !== undefined && !JSON.stringify(blockEvent).includes(outsider.name) && !JSON.stringify(blockEvent).includes(outsider.id))
const listByOther = await call("GET", `/projects/${slug}/blocks`, other.token)
check("only owners and maintainers can see the block list", listByOther.status === 403, detail(listByOther))
const unblocked = await call("DELETE", `/projects/${slug}/blocks/${outsider.id}`, owner)
const coAgain = await call("POST", `/projects/${slug}/chunks/${c2.id}/checkout`, outsider.token)
check("after the block is lifted, the user can check out again", ok(unblocked.status) && unblocked.body.length === 0 && ok(coAgain.status), detail(coAgain))

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
