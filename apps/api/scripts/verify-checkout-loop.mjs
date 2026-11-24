// The whole contributor loop, end to end, against a real matchd:
// import → board → checkout → bundle → heartbeat → submit (miss, then hit)
// → match → profile → call-target refusal → integration build → release
// → lease expiry by the sweeper.
//
// Uses fixtures/link: leaf, caller, and decoy were built with the host GCC
// image, and each chunk's "pseudocode" is its real source, so submitting it
// matches. decoy's stored bytes are caller's: its bytes compare equal once
// relocations are masked, but the call-target check sees that the original
// calls caller where decoy's source calls leaf, so it is refused in
// isolation. (Before that check, decoy matched alone and only the
// integration build caught it.)
//
// Needs the API (RATE_LIMITS=off) on a throwaway seeded database, matchd
// running (docker compose up -d matchd), and that database's URL. The expiry
// step waits for the 30-second lease sweeper.
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   node apps/api/scripts/verify-checkout-loop.mjs
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const signUp = async (label) => {
  const name = `Loop ${label} ${randomBytes(2).toString("hex")}`
  const res = await call("POST", "/auth/sign-up", undefined, {
    email: `audit-loop-${label}-${randomBytes(3).toString("hex")}@example.test`, displayName: name, password: randomBytes(18).toString("base64url")
  })
  if (!ok(res.status)) throw new Error(`sign-up failed: ${res.status}`)
  return { token: res.body.token, id: res.body.user.id, name }
}

const owner = await signUp("owner")
const alice = await signUp("alice")
const bob = await signUp("bob")
const slug = `loop-${randomBytes(3).toString("hex")}`
const P = `/projects/${slug}`

// --- Project and import.
const created = await call("POST", "/projects", owner.token, {
  slug, name: "Checkout loop", homeRegion: "us-east-1", language: fixture.language, toolchain: fixture.toolchain
})
check("the owner creates a project with the fixture's toolchain", created.status === 201, detail(created))
const imported = await call("POST", `${P}/imports`, owner.token, fixture)
check("the Ghidra export imports", ok(imported.status), detail(imported))
const board = (await call("GET", `${P}/chunks`)).body
const byName = Object.fromEntries(board.map((c) => [c.name, c]))
check("each function is an open chunk on the board",
  board.length === 3 && ["leaf", "caller", "decoy"].every((n) => byName[n]?.state === "open"), board.map((c) => `${c.name}=${c.state}`).join(","))
const stats0 = (await call("GET", P)).body.stats
check("project counts show three open", stats0.total === 3 && stats0.open === 3, JSON.stringify(stats0))

// --- Checkout and the work bundle.
const leaf = byName.leaf
const anon = await call("POST", `${P}/chunks/${leaf.id}/checkout`)
check("checkout needs a signed-in user", anon.status === 401, detail(anon))
const lease = await call("POST", `${P}/chunks/${leaf.id}/checkout`, alice.token)
check("alice checks out leaf and gets a lease and a bundle",
  ok(lease.status) && typeof lease.body.leaseToken === "string" && lease.body.chunk.state === "leased" &&
    typeof lease.body.bundle?.pseudocode === "string" && lease.body.bundle.pseudocode.includes("leaf"),
  detail(lease))
const taken = await call("POST", `${P}/chunks/${leaf.id}/checkout`, bob.token)
check("with one lease per chunk, bob cannot take leaf too", taken.status === 409, detail(taken))
const bundleByBob = await call("GET", `${P}/chunks/${leaf.id}/bundle`, bob.token)
check("the bundle is only for the lease holder", !ok(bundleByBob.status), detail(bundleByBob))
const firstExpiry = lease.body.leaseExpiresAt
await sleep(1100)
const beat = await call("POST", `${P}/chunks/${leaf.id}/heartbeat`, alice.token, { leaseToken: lease.body.leaseToken })
check("a heartbeat extends the lease",
  ok(beat.status) && new Date(beat.body.leaseExpiresAt).getTime() > new Date(firstExpiry).getTime(), detail(beat))
const leaseToken = beat.body.leaseToken ?? lease.body.leaseToken

// --- Submissions.
const waitForAttempt = async (chunkId, attemptId) => {
  for (let i = 0; i < 90; i++) {
    const rows = (await call("GET", `${P}/chunks/${chunkId}/attempts`)).body
    const row = rows.find((a) => a.id === attemptId)
    if (row?.finishedAt) return row
    await sleep(1000)
  }
  return null
}
const wrongToken = await call("POST", `${P}/chunks/${leaf.id}/submit`, bob.token, { leaseToken, source: "int leaf(int x) { return x; }\n" })
check("someone else's lease token is refused", !ok(wrongToken.status), detail(wrongToken))
const miss = await call("POST", `${P}/chunks/${leaf.id}/submit`, alice.token, {
  leaseToken, source: "int leaf(int x) {\n  return x + 5;\n}\n"
})
const missed = miss.body?.attemptId ? await waitForAttempt(leaf.id, miss.body.attemptId) : null
const afterMiss = (await call("GET", `${P}/chunks/${leaf.id}`)).body
check("a wrong source compiles, misses, and alice keeps the lease",
  ok(miss.status) && missed?.compilerOk === true && missed?.matched === false && afterMiss.state === "leased",
  `${detail(miss)} | matched=${missed?.matched} state=${afterMiss.state}`)

// A missed attempt's diagnostics quote the original bytes. Only the submitter,
// the chunk's holder, and maintainers get them; anyone else gets the score line.
const missDiagnostics = async (token) => {
  const res = await call("GET", `${P}/chunks/${leaf.id}/attempts`, token)
  return res.body?.find?.((a) => a.id === miss.body?.attemptId)?.diagnostics ?? ""
}
const hasDump = (text) => text.includes("--- original (masked) ---")
const [asAnon, asBob, asAlice, asOwner] = await Promise.all([
  missDiagnostics(undefined), missDiagnostics(bob.token), missDiagnostics(alice.token), missDiagnostics(owner.token)
])
check("the submitter sees the byte comparison on a miss", hasDump(asAlice), asAlice.split("\n")[0])
check("a project owner sees it too", hasDump(asOwner))
check("signed out, the miss shows its score but not the original bytes",
  !hasDump(asAnon) && asAnon.startsWith("score=") && asAnon.includes("Byte comparison hidden"), asAnon)
check("another signed-in user does not see the original bytes", !hasDump(asBob) && asBob.startsWith("score="), asBob)
const badToken = await call("GET", `${P}/chunks/${leaf.id}/attempts`, "not-a-real-token")
check("a bad token is treated as signed out, not refused", ok(badToken.status), detail(badToken))

const hit =await call("POST", `${P}/chunks/${leaf.id}/submit`, alice.token, { leaseToken, source: lease.body.bundle.pseudocode })
const hitRow = hit.body?.attemptId ? await waitForAttempt(leaf.id, hit.body.attemptId) : null
const afterHit = (await call("GET", `${P}/chunks/${leaf.id}`)).body
check("the real source matches and the chunk is matched",
  hitRow?.matched === true && afterHit.state === "matched", `matched=${hitRow?.matched} state=${afterHit.state} ${(hitRow?.diagnostics ?? "").split("\n")[0]}`)
const afterMatchCheckout = await call("POST", `${P}/chunks/${leaf.id}/checkout`, bob.token)
check("a matched chunk cannot be checked out again", !ok(afterMatchCheckout.status), detail(afterMatchCheckout))

// --- The match shows up for everyone.
const feed = (await call("GET", `${P}/activity`)).body
check("the feed shows the checkout and the match",
  feed.some((e) => e.kind === "checkout" && e.chunkId === leaf.id) && feed.some((e) => e.kind === "matched" && e.chunkId === leaf.id),
  feed.map((e) => e.kind).slice(0, 6).join(","))
const profile = (await call("GET", `/users/${alice.id}`)).body
const matches = (await call("GET", `/users/${alice.id}/matches?project=${slug}`)).body
check("alice's profile counts the surviving match", profile.survivingMatches >= 1 && matches.total === 1 && matches.items[0].chunkId === leaf.id,
  `surviving=${profile.survivingMatches} listed=${matches.total}`)

// --- caller matches; decoy is caught by the call-target check.
const callerLease = await call("POST", `${P}/chunks/${byName.caller.id}/checkout`, bob.token)
const callerSubmit = await call("POST", `${P}/chunks/${byName.caller.id}/submit`, bob.token, {
  leaseToken: callerLease.body.leaseToken, source: callerLease.body.bundle.pseudocode
})
const callerRow = callerSubmit.body?.attemptId ? await waitForAttempt(byName.caller.id, callerSubmit.body.attemptId) : null
check("bob matches caller", callerRow?.matched === true, `${detail(callerSubmit)} ${(callerRow?.diagnostics ?? "").split("\n")[0]}`)
const decoyId = byName.decoy.id
const decoyLease = await call("POST", `${P}/chunks/${decoyId}/checkout`, bob.token)
const decoySubmit = await call("POST", `${P}/chunks/${decoyId}/submit`, bob.token, {
  leaseToken: decoyLease.body.leaseToken, source: decoyLease.body.bundle.pseudocode
})
const decoyRow = decoySubmit.body?.attemptId ? await waitForAttempt(decoyId, decoySubmit.body.attemptId) : null
const decoyState = (await call("GET", `${P}/chunks/${decoyId}`)).body.state
check("equal masked bytes that call the wrong function are refused, and bob keeps the lease",
  decoyRow?.matched === false && /original calls caller/.test(decoyRow?.diagnostics ?? "") && decoyState === "leased",
  `matched=${decoyRow?.matched} state=${decoyState} ${(decoyRow?.diagnostics ?? "").split("\n").slice(-1)[0]}`)
const released = await call("POST", `${P}/chunks/${decoyId}/release`, bob.token, { leaseToken: decoyLease.body.leaseToken })
check("releasing returns it to the pool", ok(released.status) && released.body.state === "open", `${detail(released)} ${released.body?.state}`)
const stats1 = (await call("GET", P)).body.stats
check("project counts show two matched and one open", stats1.matched === 2 && stats1.open === 1, JSON.stringify(stats1))
const notOwner = await call("POST", `${P}/integrations`, bob.token, { language: "c" })
check("only owners and maintainers start an integration build", !ok(notOwner.status), detail(notOwner))
const started = await call("POST", `${P}/integrations`, owner.token, { language: "c" })
let integration = started.body
for (let i = 0; i < 60 && ok(started.status); i++) {
  if (integration.status !== "queued" && integration.status !== "running") break
  await sleep(1000)
  integration = (await call("GET", `${P}/integrations/${started.body.id}`)).body
}
const units = Object.fromEntries((integration?.units ?? []).map((u) => [u.name, u.passed]))
check("the integration build links the matched functions at their addresses and passes",
  ok(started.status) && integration?.status === "passed" && units.leaf === true && units.caller === true && units.decoy === undefined,
  `${detail(started)} status=${integration?.status} ${JSON.stringify(units)}`)
const final = Object.fromEntries((await call("GET", `${P}/chunks`)).body.map((c) => [c.name, c.state]))
check("after the link, leaf and caller stay matched and decoy stays open",
  final.leaf === "matched" && final.caller === "matched" && final.decoy === "open", JSON.stringify(final))

// --- Expiry.
const expiring = await call("POST", `${P}/chunks/${decoyId}/checkout`, bob.token)
await db.query(`UPDATE chunks SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [decoyId])
let swept = null
for (let i = 0; i < 40; i++) {
  await sleep(1000)
  swept = (await call("GET", `${P}/chunks/${decoyId}`)).body
  if (swept.state !== "leased") break
}
const expiredEvent = (await call("GET", `${P}/activity`)).body.some((e) => e.kind === "lease_expired" && e.chunkId === decoyId)
const staleSubmit = await call("POST", `${P}/chunks/${decoyId}/submit`, bob.token, { leaseToken: expiring.body.leaseToken, source: "int decoy(int x) { return x; }\n" })
check("an expired lease is swept back to the pool, and its token stops working",
  ok(expiring.status) && swept?.state !== "leased" && expiredEvent && !ok(staleSubmit.status),
  `state=${swept?.state} event=${expiredEvent} submit=${staleSubmit.status}`)

await db.end()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
