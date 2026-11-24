// End-to-end checks for audit A-011 (members, roles, ownership transfer).
//
// Needs an API with RATE_LIMITS=off on a throwaway seeded database, and
// that database's URL (one check moves an offer's expiry into the past).
// Creates one project (sample fixture) owned by the dev user and four test
// accounts.
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   node apps/api/scripts/verify-members.mjs
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
  const name = `Members ${label} ${randomBytes(2).toString("hex")}`
  const res = await call("POST", "/auth/sign-up", undefined, {
    email: `audit-members-${label}-${randomBytes(3).toString("hex")}@example.test`, displayName: name, password: randomBytes(18).toString("base64url")
  })
  if (!ok(res.status)) throw new Error(`sign-up failed: ${res.status}`)
  return { token: res.body.token, id: res.body.user.id, name }
}
const roleOf = (list, id) => list.find((m) => m.userId === id)?.role ?? null

const devToken = (await call("POST", "/auth/sign-in", undefined, { email: "dev@re-hydra.local", password: "rehydra-dev" })).body.token
const devMe = (await call("GET", "/auth/me", devToken)).body
const dev = { token: devToken, id: devMe.id, name: devMe.displayName }
const a = await signUp("a")
const b = await signUp("b")
const c = await signUp("c")
const outsider = await signUp("x")
const slug = `members-${randomBytes(3).toString("hex")}`
const created = await call("POST", "/projects", dev.token, {
  slug, name: "Members check", homeRegion: "us-east-1", language: "c",
  toolchain: { compiler: "gcc", version: "4.8.5", flags: ["-O2"], image: "ghcr.io/re-hydra/gcc:4.8.5@sha256:dev" }
})
if (created.status !== 201) throw new Error(`project create failed: ${detail(created)}`)
await call("POST", `/projects/${slug}/imports`, dev.token, sample)
const chunks = (await call("GET", `/projects/${slug}/chunks`)).body
const P = `/projects/${slug}`
const feedSummaries = async () => (await call("GET", `${P}/activity`)).body.map((e) => e.summary)

// --- Listing and adding.
const initial = await call("GET", `${P}/members`)
check("anyone can list members; a new project has only its owner",
  initial.status === 200 && initial.body.length === 1 && roleOf(initial.body, dev.id) === "owner", detail(initial))
const byOutsider = await call("POST", `${P}/members`, outsider.token, { userId: c.id, role: "contributor" })
check("a non-member cannot add members", byOutsider.status === 403, detail(byOutsider))
const addA = await call("POST", `${P}/members`, dev.token, { userId: a.id, role: "maintainer" })
check("the owner adds a maintainer", ok(addA.status) && roleOf(addA.body, a.id) === "maintainer", detail(addA))
const addB = await call("POST", `${P}/members`, a.token, { userId: b.id, role: "contributor" })
check("a maintainer adds a contributor", ok(addB.status) && roleOf(addB.body, b.id) === "contributor", detail(addB))
const aAddsMaintainer = await call("POST", `${P}/members`, a.token, { userId: c.id, role: "maintainer" })
check("a maintainer cannot add a maintainer", aAddsMaintainer.status === 403 && /Only the owner/.test(aAddsMaintainer.body?.detail ?? ""), detail(aAddsMaintainer))
const again = await call("POST", `${P}/members`, dev.token, { userId: b.id, role: "contributor" })
check("adding an existing member is a conflict", again.status === 409, detail(again))
const unknown = await call("POST", `${P}/members`, dev.token, { userId: "00000000-0000-4000-8000-000000000000", role: "contributor" })
check("adding an unknown user is not found", unknown.status === 404, detail(unknown))
const feed1 = await feedSummaries()
check("the feed names who joined and as what", feed1.includes(`${a.name} joined as maintainer`) && feed1.includes(`${b.name} joined as contributor`))

// --- Roles.
const aPromotes = await call("PATCH", `${P}/members/${b.id}`, a.token, { role: "maintainer" })
check("a maintainer cannot change roles", aPromotes.status === 403, detail(aPromotes))
const promote = await call("PATCH", `${P}/members/${b.id}`, dev.token, { role: "maintainer" })
const demote = await call("PATCH", `${P}/members/${b.id}`, dev.token, { role: "contributor" })
check("the owner promotes and demotes", roleOf(promote.body, b.id) === "maintainer" && roleOf(demote.body, b.id) === "contributor", `${detail(promote)} | ${detail(demote)}`)
const ownerSelfRole = await call("PATCH", `${P}/members/${dev.id}`, dev.token, { role: "maintainer" })
check("the owner's own role changes only by transfer", ownerSelfRole.status === 403, detail(ownerSelfRole))

// --- Removing and leaving.
const aRemovesOwner = await call("DELETE", `${P}/members/${dev.id}`, a.token)
check("a maintainer cannot remove the owner", aRemovesOwner.status === 403, detail(aRemovesOwner))
const ownerLeaves = await call("DELETE", `${P}/members/${dev.id}`, dev.token)
check("the owner cannot leave without handing over ownership", ownerLeaves.status === 403 && /Hand over/.test(ownerLeaves.body?.detail ?? ""), detail(ownerLeaves))
const aRemovesB = await call("DELETE", `${P}/members/${b.id}`, a.token)
check("a maintainer removes a contributor", ok(aRemovesB.status) && roleOf(aRemovesB.body, b.id) === null, detail(aRemovesB))
await call("POST", `${P}/members`, dev.token, { userId: c.id, role: "maintainer" })
const aRemovesC = await call("DELETE", `${P}/members/${c.id}`, a.token)
check("a maintainer cannot remove another maintainer", aRemovesC.status === 403, detail(aRemovesC))
await call("DELETE", `${P}/members/${c.id}`, dev.token)

// --- Members-only: leaving ends your leases there.
await call("POST", `${P}/members`, dev.token, { userId: b.id, role: "contributor" })
await call("PATCH", `${P}/settings`, dev.token, { checkoutPolicy: "members" })
const leaseB = await call("POST", `${P}/chunks/${chunks[0].id}/checkout`, b.token)
const leaves = await call("DELETE", `${P}/members/${b.id}`, b.token)
const chunkAfter = (await call("GET", `${P}/chunks/${chunks[0].id}`)).body
const bRetry = await call("POST", `${P}/chunks/${chunks[0].id}/checkout`, b.token)
check("on a members-only project, leaving ends your leases and your access",
  ok(leaseB.status) && ok(leaves.status) && chunkAfter.state === "open" && bRetry.status === 403,
  `lease ${leaseB.status}, leave ${leaves.status}, chunk ${chunkAfter.state}, retry ${bRetry.status}`)
check("the feed records that they left", (await feedSummaries()).includes(`${b.name} left the project`))
await call("PATCH", `${P}/settings`, dev.token, { checkoutPolicy: "open" })

// --- Blocks and membership.
await call("POST", `${P}/blocks`, dev.token, { userId: c.id })
const addBlocked = await call("POST", `${P}/members`, dev.token, { userId: c.id, role: "contributor" })
check("a blocked user cannot be added", addBlocked.status === 403 && /blocked/.test(addBlocked.body?.detail ?? ""), detail(addBlocked))
await call("DELETE", `${P}/blocks/${c.id}`, dev.token)
await call("POST", `${P}/members`, dev.token, { userId: c.id, role: "contributor" })
await call("POST", `${P}/blocks`, dev.token, { userId: c.id })
const afterBlock = (await call("GET", `${P}/members`)).body
check("blocking a contributor removes them from the project", roleOf(afterBlock, c.id) === null)
await call("DELETE", `${P}/blocks/${c.id}`, dev.token)
const blockMaintainer = await call("POST", `${P}/blocks`, dev.token, { userId: a.id })
check("a maintainer cannot be blocked", blockMaintainer.status === 403 && /Demote/.test(blockMaintainer.body?.detail ?? ""), detail(blockMaintainer))

// --- Ownership transfer.
const offerByA = await call("POST", `${P}/ownership-transfer`, a.token, { userId: b.id })
check("only the owner can offer ownership", offerByA.status === 403, detail(offerByA))
const offer = await call("POST", `${P}/ownership-transfer`, dev.token, { userId: a.id })
check("the owner offers ownership", ok(offer.status) && offer.body.offer?.offeredTo === a.id, detail(offer))
const second = await call("POST", `${P}/ownership-transfer`, dev.token, { userId: b.id })
check("only one open offer at a time", second.status === 409, detail(second))
const seenByC = await call("GET", `${P}/ownership-transfer`, c.token)
const seenByA = await call("GET", `${P}/ownership-transfer`, a.token)
const mine = await call("GET", "/ownership-offers", a.token)
check("the offer is visible to the two people in it, and nobody else",
  seenByC.body.offer === null && seenByA.body.offer?.offeredBy === dev.id && mine.body.some((o) => o.projectSlug === slug),
  `${seenByC.status}/${seenByA.status}/${mine.status}`)
const wrongAccept = await call("POST", `${P}/ownership-transfer/accept`, b.token)
check("someone else cannot accept the offer", wrongAccept.status === 404, detail(wrongAccept))
const accepted = await call("POST", `${P}/ownership-transfer/accept`, a.token)
check("accepting makes them owner and the old owner a maintainer",
  ok(accepted.status) && roleOf(accepted.body, a.id) === "owner" && roleOf(accepted.body, dev.id) === "maintainer" &&
    accepted.body.filter((m) => m.role === "owner").length === 1, detail(accepted))
check("the feed records the new owner", (await feedSummaries()).includes(`${a.name} is now the owner`))
const devAfter = await call("GET", `${P}/membership`, dev.token)
check("the old owner's permissions follow the new role", devAfter.body.role === "maintainer", detail(devAfter))

// Decline, withdraw, expiry, and a block cancelling an offer.
await call("POST", `${P}/ownership-transfer`, a.token, { userId: dev.id })
const declined = await call("DELETE", `${P}/ownership-transfer`, dev.token)
const afterDecline = await call("GET", `${P}/ownership-transfer`, a.token)
check("the recipient can decline", ok(declined.status) && afterDecline.body.offer === null && (await feedSummaries()).includes(`${dev.name} declined ownership`), detail(declined))
await call("POST", `${P}/ownership-transfer`, a.token, { userId: b.id })
const byNonOwner = await call("DELETE", `${P}/ownership-transfer`, dev.token)
const withdrawn = await call("DELETE", `${P}/ownership-transfer`, a.token)
check("only the owner or the recipient can withdraw", byNonOwner.status === 403 && ok(withdrawn.status), `${byNonOwner.status} / ${withdrawn.status}`)
const toExpire = await call("POST", `${P}/ownership-transfer`, a.token, { userId: b.id })
await db.query(`UPDATE ownership_transfers SET expires_at = now() - interval '1 minute' WHERE id = $1`, [toExpire.body.offer.id])
const lateAccept = await call("POST", `${P}/ownership-transfer/accept`, b.token)
const fresh = await call("POST", `${P}/ownership-transfer`, a.token, { userId: c.id })
const expiredRow = (await db.query(`SELECT state FROM ownership_transfers WHERE id = $1`, [toExpire.body.offer.id])).rows[0]
check("an expired offer cannot be accepted, and does not block a new one",
  lateAccept.status === 404 && ok(fresh.status) && expiredRow.state === "expired", `${lateAccept.status}, ${fresh.status}, ${expiredRow.state}`)
await call("POST", `${P}/blocks`, a.token, { userId: c.id })
const afterBlockOffer = await call("GET", `${P}/ownership-transfer`, a.token)
const blockedAccept = await call("POST", `${P}/ownership-transfer/accept`, c.token)
check("blocking the recipient cancels the offer", afterBlockOffer.body.offer === null && blockedAccept.status === 404, `${blockedAccept.status}`)
await call("DELETE", `${P}/blocks/${c.id}`, a.token)

// --- The two-person rule is now reachable: owner a, maintainer dev.
const proposal = await call("POST", `${P}/type-proposals`, dev.token, { title: "two-person check", headers: "typedef int s32;\n" })
const started = await call("POST", `${P}/type-proposals/${proposal.body.id}/revalidate`, dev.token)
const ready = (await call("GET", `${P}/type-proposals/${proposal.body.id}`)).body
const selfAccept = await call("POST", `${P}/type-proposals/${proposal.body.id}/accept`, dev.token)
const otherAccept = await call("POST", `${P}/type-proposals/${proposal.body.id}/accept`, a.token)
check("with two reviewers, the person who started the recheck cannot accept; the other can",
  ok(started.status) && ready.state === "ready" && selfAccept.status === 409 && ok(otherAccept.status),
  `start ${started.status}, state ${ready.state}, self ${selfAccept.status}, other ${otherAccept.status}`)

await db.end()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
