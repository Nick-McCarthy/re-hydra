// End-to-end checks for scoped profile tokens (foundations plan 2, migration 027).
//
// A work token may do contributor work and read its holder's own data; the
// server refuses it everything else with 403 TokenScopeRefused. A full token
// and a session can do anything the account can.
//
// Needs an API with RATE_LIMITS=off on a throwaway seeded database (the
// `demo` project and the dev user from `npm run api:seed`).
//
//   AUDIT_API=http://localhost:3100/v1 \
//   node apps/api/scripts/verify-token-scopes.mjs
import { randomBytes } from "node:crypto"

const API = process.env.AUDIT_API ?? "http://localhost:3100/v1"
const PROJECT = process.env.AUDIT_PROJECT ?? "demo"

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
const scopeRefused = (r) => r.status === 403 && String(r.body?.type ?? "").endsWith("/token-scope-refused")
const show = (r) => `${r.status}${r.body?.reason ? ` ${r.body.reason}` : ""}${r.body?.type ? ` ${String(r.body.type).split("/").pop()}` : ""}`

const signUp = await call("POST", "/auth/sign-up", undefined, {
  email: `audit-scopes-${randomBytes(3).toString("hex")}@example.test`,
  displayName: `Scopes ${randomBytes(2).toString("hex")}`,
  password: randomBytes(18).toString("base64url"),
  acceptPolicy: true
})
if (!ok(signUp.status)) throw new Error(`sign-up failed: ${signUp.status}`)
const session = signUp.body.token

// Creating tokens
const defaulted = await call("POST", "/auth/tokens", session, { label: "agent" })
check("a token created without a scope is a work token", ok(defaulted.status) && defaulted.body.scope === "work", show(defaulted))
const work = defaulted.body.token
const fullCreated = await call("POST", "/auth/tokens", session, { label: "me", scope: "all" })
check("a full token can be created", ok(fullCreated.status) && fullCreated.body.scope === "all", show(fullCreated))
const full = fullCreated.body.token
const badScope = await call("POST", "/auth/tokens", session, { label: "x", scope: "admin" })
check("an unknown scope is refused", badScope.status === 400, show(badScope))
const listed = await call("GET", "/auth/tokens", session)
check("the token list shows each scope",
  ok(listed.status) && listed.body.some((t) => t.scope === "work") && listed.body.some((t) => t.scope === "all"),
  `${listed.body.map?.((t) => t.scope).join(",")}`)

// What a work token may do
const me = await call("GET", "/auth/me", work)
check("work token: who am I", ok(me.status), show(me))
const board = await call("GET", `/projects/${PROJECT}/chunks?state=open&limit=1`, work)
check("work token: read the board", ok(board.status) && board.body.length === 1, show(board))
const chunkId = board.body[0]?.id
const lease = await call("POST", `/projects/${PROJECT}/chunks/${chunkId}/checkout`, work)
check("work token: check out", ok(lease.status), show(lease))
const bundle = await call("GET", `/projects/${PROJECT}/chunks/${chunkId}/bundle`, work)
check("work token: read the work bundle", ok(bundle.status), show(bundle))
const beat = await call("POST", `/projects/${PROJECT}/chunks/${chunkId}/heartbeat`, work, { leaseToken: lease.body.leaseToken })
check("work token: heartbeat", ok(beat.status), show(beat))
const proposal = await call("POST", `/projects/${PROJECT}/type-proposals`, work, { title: "scope check", headers: "typedef int scope_check_t;\n" })
check("work token: propose types is not refused for scope", !scopeRefused(proposal), show(proposal))
const release = await call("POST", `/projects/${PROJECT}/chunks/${chunkId}/release`, work, { leaseToken: lease.body.leaseToken })
check("work token: release", ok(release.status), show(release))
const myWork = await call("GET", "/me/work", work)
check("work token: read my own work", ok(myWork.status), show(myWork))

// What a work token may not do
const refusals = [
  ["start an integration build", "POST", `/projects/${PROJECT}/integrations`, {}],
  ["create a project", "POST", "/projects", { slug: `scopes-${randomBytes(3).toString("hex")}`, name: "x" }],
  ["create another token", "POST", "/auth/tokens", { label: "more", scope: "all" }],
  ["list tokens", "GET", "/auth/tokens", undefined],
  ["revoke a token", "DELETE", `/auth/tokens/${fullCreated.body.id}`, undefined],
  ["change the password", "POST", "/auth/password", { currentPassword: "x", newPassword: "y".repeat(12) }],
  ["accept a type proposal", "POST", `/projects/${PROJECT}/type-proposals/${crypto.randomUUID()}/accept`, undefined],
  ["import an export", "POST", `/projects/${PROJECT}/imports?rightsConfirmed=true`, {}],
  ["follow a project", "POST", `/projects/${PROJECT}/follow`, undefined],
  ["start a discussion thread", "POST", `/projects/${PROJECT}/threads`, { title: "x", body: "y" }],
  ["file a report", "POST", "/reports", { reason: "other", projectSlug: PROJECT, note: "x" }],
  ["open the admin reports", "GET", "/admin/reports?status=open", undefined]
]
for (const [what, method, p, body] of refusals) {
  const r = await call(method, p, work, body)
  check(`work token is refused: ${what}`, scopeRefused(r) && typeof r.body.detail === "string", show(r))
}

// A full token and a session are not limited by scope
const fullTokens = await call("GET", "/auth/tokens", full)
check("full token: list tokens", ok(fullTokens.status), show(fullTokens))
const fullFollow = await call("POST", `/projects/${PROJECT}/follow`, full)
check("full token: follow a project", ok(fullFollow.status), show(fullFollow))
const sessionTokens = await call("GET", "/auth/tokens", session)
check("session: list tokens", ok(sessionTokens.status), show(sessionTokens))

// Revoked tokens stop working whatever their scope
await call("DELETE", `/auth/tokens/${defaulted.body.id}`, session)
const afterRevoke = await call("GET", "/auth/me", work)
check("a revoked work token is not signed in", afterRevoke.status === 401, show(afterRevoke))

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
