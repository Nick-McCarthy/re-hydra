// End-to-end checks for join requests on members-only projects.
//
// Needs an API with RATE_LIMITS=off on a throwaway seeded database, and that
// database's URL (one check moves a decline 8 days into the past).
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   node apps/api/scripts/verify-join.mjs
import { randomBytes } from "node:crypto"
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
const sample = JSON.parse(readFileSync(path.join(root, "fixtures/sample/export.json"), "utf8"))
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
const signUp = async (label) => {
  const name = `Join ${label} ${randomBytes(2).toString("hex")}`
  const res = await call("POST", "/auth/sign-up", undefined, {
    email: `audit-join-${label}-${randomBytes(3).toString("hex")}@example.test`, displayName: name, password: randomBytes(18).toString("base64url"), acceptPolicy: true
  })
  if (!ok(res.status)) throw new Error(`sign-up failed: ${res.status}`)
  return { token: res.body.token, id: res.body.user.id, name }
}

const owner = (await call("POST", "/auth/sign-in", undefined, { email: "dev@re-hydra.local", password: "rehydra-dev" })).body.token
const m = await signUp("maintainer")
const r = await signUp("applicant")
const x = await signUp("blocked")
const c = await signUp("direct")
const outsider = await signUp("outsider")
const slug = `join-${randomBytes(3).toString("hex")}`
const created = await call("POST", "/projects", owner, {
  slug, name: "Join check", homeRegion: "us-east-1", language: "c",
  toolchain: { compiler: "gcc", version: "4.8.5", flags: ["-O2"], image: "ghcr.io/re-hydra/gcc:4.8.5@sha256:dev" }
})
if (created.status !== 201) throw new Error(`project create failed: ${detail(created)}`)
await call("POST", `/projects/${slug}/imports?rightsConfirmed=true`, owner, sample)
const chunk = (await call("GET", `/projects/${slug}/chunks`)).body[0]
const P = `/projects/${slug}`
await call("POST", `${P}/members`, owner, { userId: m.id, role: "maintainer" })

// --- Who may ask.
const onOpen = await call("POST", `${P}/join-request`, r.token, { message: "hi" })
check("an open project does not take requests", onOpen.status === 409 && /open to everyone/.test(onOpen.body?.detail ?? ""), detail(onOpen))
await call("PATCH", `${P}/settings`, owner, { checkoutPolicy: "members" })
const byMember = await call("POST", `${P}/join-request`, m.token, {})
check("a member cannot ask", byMember.status === 409 && /already a member/.test(byMember.body?.detail ?? ""), detail(byMember))
const anon = await call("POST", `${P}/join-request`, undefined, {})
check("asking needs a signed-in user", anon.status === 401, detail(anon))
const tooLong = await call("POST", `${P}/join-request`, r.token, { message: "x".repeat(201) })
check("the message is capped at 200 characters", tooLong.status === 400, detail(tooLong))

// --- Asking, seeing, cancelling.
const asked = await call("POST", `${P}/join-request`, r.token, { message: "I'd like to work on the parsers" })
check("a non-member asks with a message", ok(asked.status) && asked.body.request?.message === "I'd like to work on the parsers", detail(asked))
const twice = await call("POST", `${P}/join-request`, r.token, {})
check("one open request at a time", twice.status === 409 && /already asked/.test(twice.body?.detail ?? ""), detail(twice))
const listByR = await call("GET", `${P}/join-requests`, r.token)
const listByOutsider = await call("GET", `${P}/join-requests`, outsider.token)
check("only owners and maintainers see the list", listByR.status === 403 && listByOutsider.status === 403, `${listByR.status}/${listByOutsider.status}`)
const listByOwner = await call("GET", `${P}/join-requests`, owner)
check("the owner sees the request with its message", ok(listByOwner.status) && listByOwner.body.length === 1 && listByOwner.body[0].userId === r.id, detail(listByOwner))
const mForMe = (await call("GET", "/me/join-requests", m.token)).body
const rForMe = (await call("GET", "/me/join-requests", r.token)).body
check("/me/join-requests: waiting on the maintainer, and listed as the requester's own",
  mForMe.waitingOnYou.some((q) => q.projectSlug === slug && q.userId === r.id) && rForMe.yours.some((q) => q.projectSlug === slug) && rForMe.waitingOnYou.length === 0)
const cancelled = await call("DELETE", `${P}/join-request`, r.token)
const afterCancel = (await call("GET", `${P}/join-requests`, owner)).body
check("the requester can cancel", ok(cancelled.status) && cancelled.body.request === null && afterCancel.length === 0, detail(cancelled))
const askedAgain = await call("POST", `${P}/join-request`, r.token, {})
check("cancelling does not start a wait", ok(askedAgain.status), detail(askedAgain))

// --- Decline and the 7-day wait.
const reqId = askedAgain.body.request.id
const declinedByR = await call("POST", `${P}/join-requests/${reqId}/decline`, r.token)
check("the requester cannot answer their own request", declinedByR.status === 403, detail(declinedByR))
const declined = await call("POST", `${P}/join-requests/${reqId}/decline`, owner)
const mine = (await call("GET", `${P}/join-request`, r.token)).body
check("after a decline, the requester sees when they may ask again",
  ok(declined.status) && mine.request === null && mine.retryAfter !== null && new Date(mine.retryAfter).getTime() > Date.now() + 6 * 86_400_000, mine.retryAfter ?? "none")
const tooSoon = await call("POST", `${P}/join-request`, r.token, {})
check("asking again within 7 days is refused", tooSoon.status === 409 && /declined/.test(tooSoon.body?.detail ?? ""), detail(tooSoon))
await db.query(`UPDATE join_requests SET resolved_at = now() - interval '8 days' WHERE id = $1`, [reqId])
const afterWait = await call("POST", `${P}/join-request`, r.token, { message: "trying again" })
check("after 7 days they may ask again", ok(afterWait.status), detail(afterWait))

// --- Approve.
const preCheckout = await call("POST", `${P}/chunks/${chunk.id}/checkout`, r.token)
const approved = await call("POST", `${P}/join-requests/${afterWait.body.request.id}/approve`, m.token)
const members = (await call("GET", `${P}/members`)).body
const postCheckout = await call("POST", `${P}/chunks/${chunk.id}/checkout`, r.token)
check("a maintainer approves: the requester becomes a contributor and can work",
  ok(approved.status) && approved.body.length === 0 && members.find((x) => x.userId === r.id)?.role === "contributor" &&
    preCheckout.status === 403 && ok(postCheckout.status),
  `${detail(approved)} | before ${preCheckout.status}, after ${postCheckout.status}`)
const feed = (await call("GET", `${P}/activity`)).body.map((e) => e.summary)
check("the feed shows the join, not the requests or the decline",
  feed.includes(`${r.name} joined as contributor`) && !feed.some((s) => /request|declin|asked/i.test(s)))
const again = await call("POST", `${P}/join-requests/${afterWait.body.request.id}/approve`, owner)
check("an answered request cannot be answered again", again.status === 404, detail(again))

// --- Blocks and direct adds.
const xAsked = await call("POST", `${P}/join-request`, x.token, {})
await call("POST", `${P}/blocks`, owner, { userId: x.id })
const afterBlock = (await call("GET", `${P}/join-requests`, owner)).body
const xAgain = await call("POST", `${P}/join-request`, x.token, {})
check("blocking cancels the request, and a blocked user cannot ask",
  ok(xAsked.status) && !afterBlock.some((q) => q.userId === x.id) && xAgain.status === 403, `${xAgain.status}`)
const cAsked = await call("POST", `${P}/join-request`, c.token, {})
await call("POST", `${P}/members`, owner, { userId: c.id, role: "contributor" })
const cState = (await call("GET", `${P}/join-request`, c.token)).body
const cRow = (await db.query(`SELECT state, resolved_by FROM join_requests WHERE id = $1`, [cAsked.body.request.id])).rows[0]
check("adding someone directly answers their request", cState.request === null && cRow.state === "approved", cRow.state)

// --- Wrong project.
const other = `join-${randomBytes(3).toString("hex")}`
await call("POST", "/projects", owner, {
  slug: other, name: "Join other", homeRegion: "us-east-1", language: "c",
  toolchain: { compiler: "gcc", version: "4.8.5", flags: ["-O2"], image: "ghcr.io/re-hydra/gcc:4.8.5@sha256:dev" }
})
await call("PATCH", `/projects/${other}/settings`, owner, { checkoutPolicy: "members" })
const oAsked = await call("POST", `/projects/${other}/join-request`, outsider.token, {})
const crossed = await call("POST", `${P}/join-requests/${oAsked.body.request.id}/approve`, owner)
check("a request id from another project is not found here", crossed.status === 404, detail(crossed))

await db.end()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
