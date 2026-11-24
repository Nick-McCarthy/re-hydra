// End-to-end checks for profile phase 1: /me/work, /users/:id/matches,
// /users/:id/projects. Needs an API with RATE_LIMITS=off and matchd running,
// on a throwaway seeded database (one check marks a match invalidated).
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   node apps/api/scripts/verify-profile.mjs
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
const until = async (what, fn, ms = 90_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timed out waiting for ${what}`)
}
const signUp = async (label) => {
  const res = await call("POST", "/auth/sign-up", undefined, {
    email: `audit-profile-${label}-${randomBytes(3).toString("hex")}@example.test`,
    displayName: `Profile ${label} ${randomBytes(2).toString("hex")}`,
    password: randomBytes(18).toString("base64url")
  })
  if (!ok(res.status)) throw new Error(`sign-up failed: ${res.status}`)
  return { token: res.body.token, id: res.body.user.id }
}

// skip_space from fixtures/sample/funcs.c, and a variant that compiles but differs.
const HIT = "int skip_space(const char *p) {\n  return *p == ' ';\n}\n"
const MISS = "int skip_space(const char *p) {\n  return *p == 'x';\n}\n"

const dev = (await call("POST", "/auth/sign-in", undefined, { email: "dev@re-hydra.local", password: "rehydra-dev" })).body.token
const u = await signUp("u")
const v = await signUp("v")
const makeProject = async () => {
  const slug = `profile-${randomBytes(3).toString("hex")}`
  const created = await call("POST", "/projects", dev, {
    slug, name: `Profile check ${slug.slice(-6)}`, homeRegion: "us-east-1", language: "c",
    toolchain: { compiler: "gcc", version: "4.8.5", flags: ["-O2"], image: "ghcr.io/re-hydra/gcc:4.8.5@sha256:dev" }
  })
  if (created.status !== 201) throw new Error(`project create failed: ${detail(created)}`)
  await call("POST", `/projects/${slug}/imports`, dev, sample)
  const chunks = (await call("GET", `/projects/${slug}/chunks`)).body
  const byName = Object.fromEntries(chunks.map((c) => [c.name, c]))
  return { slug, byName }
}
const p1 = await makeProject()
const p2 = await makeProject()
await call("PATCH", `/projects/${p1.slug}/settings`, dev, { maxConcurrentLeases: 2 })

// --- /me/work
const anon = await call("GET", "/me/work")
check("/me/work needs a signed-in user", anon.status === 401, detail(anon))
const empty = await call("GET", "/me/work", u.token)
check("a new user has no leases or submissions",
  ok(empty.status) && empty.body.leases.length === 0 && empty.body.checking.length === 0 && empty.body.recent.length === 0, detail(empty))

const parse1 = p1.byName.skip_space
const size1 = p1.byName.header_size
const primary = await call("POST", `/projects/${p1.slug}/chunks/${parse1.id}/checkout`, u.token)
await call("POST", `/projects/${p1.slug}/chunks/${size1.id}/checkout`, v.token)
const competing = await call("POST", `/projects/${p1.slug}/chunks/${size1.id}/checkout`, u.token)
const work = (await call("GET", "/me/work", u.token)).body
const kinds = work.leases.map((l) => `${l.chunkName}:${l.kind}`).sort().join(",")
check("/me/work lists primary and competing leases with their tokens",
  ok(primary.status) && ok(competing.status) && kinds === "header_size:competing,skip_space:primary" &&
    work.leases.some((l) => l.leaseToken === primary.body.leaseToken) && work.leases.some((l) => l.leaseToken === competing.body.leaseToken),
  `${primary.status}/${competing.status} ${kinds}`)
check("leases are ordered soonest to expire first",
  work.leases.every((l, i, all) => i === 0 || all[i - 1].leaseExpiresAt <= l.leaseExpiresAt))
const otherWork = (await call("GET", "/me/work", v.token)).body
check("another user does not see these leases", otherWork.leases.length === 1 && otherWork.leases[0].kind === "primary")
const hb = await call("POST", `/projects/${p1.slug}/chunks/${size1.id}/heartbeat`, u.token, { leaseToken: competing.body.leaseToken })
check("the listed token extends a competing lease", ok(hb.status), detail(hb))
const rel = await call("POST", `/projects/${p1.slug}/chunks/${size1.id}/release`, u.token, { leaseToken: competing.body.leaseToken })
const afterRelease = (await call("GET", "/me/work", u.token)).body
check("releasing it removes it from the list", ok(rel.status) && afterRelease.leases.length === 1, detail(rel))

// Submissions. The sample fixture's functions keep their alignment padding,
// so no source can match them; the seeded demo chunk (a lone ret) does.
const submitAndWait = async (slug, chunkId, leaseToken, source) => {
  const sub = await call("POST", `/projects/${slug}/chunks/${chunkId}/submit`, u.token, { leaseToken, source })
  if (!ok(sub.status)) throw new Error(`submit failed: ${detail(sub)}`)
  return sub
}
await submitAndWait(p1.slug, parse1.id, primary.body.leaseToken, MISS)
const checking = (await call("GET", "/me/work", u.token)).body
const missDone = await until("the miss to finish", async () => {
  const w = (await call("GET", "/me/work", u.token)).body
  return w.recent.length > 0 && w.checking.length === 0 ? w : undefined
})
check("a submission shows as checking, then as a missed result",
  (checking.checking.length === 1 || checking.recent.length === 1) && missDone.recent[0].result === "missed" && missDone.recent[0].chunkName === "skip_space",
  `checking ${checking.checking.length}, result ${missDone.recent[0]?.result}`)
await call("POST", `/projects/${p1.slug}/chunks/${parse1.id}/release`, u.token, { leaseToken: primary.body.leaseToken })

const demo = (await db.query(`
  SELECT c.id FROM chunks c INNER JOIN projects p ON p.id = c.project_id
  WHERE p.slug = 'demo' AND c.fuse_parent_id IS NULL LIMIT 1`)).rows[0]
const resetDemo = async () => {
  await db.query(`DELETE FROM jobs WHERE chunk_id = $1`, [demo.id])
  await db.query(`UPDATE chunks SET current_match_id = NULL, best_attempt_id = NULL WHERE id = $1`, [demo.id])
  await db.query(`DELETE FROM matches WHERE chunk_id = $1`, [demo.id])
  await db.query(`DELETE FROM attempts WHERE chunk_id = $1`, [demo.id])
  await db.query(`DELETE FROM chunk_leases WHERE chunk_id = $1`, [demo.id])
  await db.query(`
    UPDATE chunks SET state = 'open', lease_user_id = NULL, lease_token = NULL,
      lease_expires_at = NULL, hold_started_at = NULL
    WHERE id = $1`, [demo.id])
}
await resetDemo()
const demoLease = await call("POST", `/projects/demo/chunks/${demo.id}/checkout`, u.token)
await submitAndWait("demo", demo.id, demoLease.body.leaseToken, "void parse_header(void) {}\n")
const hitDone = await until("the match to finish", async () => {
  const w = (await call("GET", "/me/work", u.token)).body
  return w.recent.length > 1 && w.checking.length === 0 ? w : undefined
})
check("a matching submission shows as matched, newest first",
  hitDone.recent[0].result === "matched" && hitDone.recent[1].result === "missed", hitDone.recent.map((r) => r.result).join(","))

// A second match, in p2, for paging and filters. No sample function can
// match, so record one straight from a real attempt.
const parse2 = p2.byName.skip_space
const lease2 = await call("POST", `/projects/${p2.slug}/chunks/${parse2.id}/checkout`, u.token)
await submitAndWait(p2.slug, parse2.id, lease2.body.leaseToken, MISS)
await until("the second attempt", async () => {
  const w = (await call("GET", "/me/work", u.token)).body
  return w.recent.length > 2 && w.checking.length === 0 ? w : undefined
})
await call("POST", `/projects/${p2.slug}/chunks/${parse2.id}/release`, u.token, { leaseToken: lease2.body.leaseToken })
const att = (await db.query(
  `SELECT id, source_sha256, type_revision_id, language FROM attempts WHERE user_id = $1 AND chunk_id = $2 ORDER BY created_at DESC LIMIT 1`,
  [u.id, parse2.id]
)).rows[0]
const inserted = (await db.query(
  `INSERT INTO matches (chunk_id, attempt_id, user_id, type_revision_id, toolchain_digest, canonical_sha256, language, created_at)
   VALUES ($1, $2, $3, $4, 'verify-profile', $5, $6, now() + interval '1 second') RETURNING id`,
  [parse2.id, att.id, u.id, att.type_revision_id, att.source_sha256, att.language]
)).rows[0]
await db.query(`UPDATE chunks SET current_match_id = $2, best_attempt_id = $3, state = 'matched' WHERE id = $1`, [parse2.id, inserted.id, att.id])

// --- /users/:id/matches
const M = `/users/${u.id}/matches`
const all = (await call("GET", M)).body
check("matches lists every match with a total", all.total === 2 && all.items.length === 2, `total ${all.total}`)
const pageA = (await call("GET", `${M}?limit=1&offset=0`)).body
const pageB = (await call("GET", `${M}?limit=1&offset=1`)).body
const pageC = (await call("GET", `${M}?limit=1&offset=2`)).body
check("pages do not overlap, and past the end is empty with the same total",
  pageA.items[0].matchId !== pageB.items[0].matchId && pageC.items.length === 0 && pageC.total === 2)
const oldest = (await call("GET", `${M}?sort=oldest`)).body
check("sort=oldest reverses the order", oldest.items[0].matchId === all.items[1].matchId)
const onlyP2 = (await call("GET", `${M}?project=${p2.slug}`)).body
check("filtering by project", onlyP2.total === 1 && onlyP2.items[0].projectSlug === p2.slug)
await db.query(`UPDATE matches SET invalidated_at = now() WHERE user_id = $1 AND chunk_id = $2`, [u.id, demo.id])
const active = (await call("GET", `${M}?status=active`)).body
const invalid = (await call("GET", `${M}?status=invalidated`)).body
check("filtering by status", active.total === 1 && invalid.total === 1 && invalid.items[0].active === false)
const bad = await call("GET", `${M}?limit=101`)
const unknown = await call("GET", "/users/00000000-0000-4000-8000-000000000000/matches")
check("limit is capped at 100 and unknown users are not found", bad.status === 400 && unknown.status === 404, `${bad.status}/${unknown.status}`)

// --- /users/:id/projects
const before = (await call("GET", `/users/${u.id}/projects`)).body
check("projects lists projects with surviving matches, not members",
  before.length === 1 && before[0].slug === p2.slug && before[0].role === null && before[0].matchCount === 1,
  JSON.stringify(before.map((p) => [p.slug, p.role, p.matchCount])))
await call("POST", `/projects/${p1.slug}/members`, dev, { userId: u.id, role: "contributor" })
const after = (await call("GET", `/users/${u.id}/projects`)).body
check("memberships appear first, including contributor",
  after.length === 2 && after[0].slug === p1.slug && after[0].role === "contributor" && after[0].matchCount === 0,
  JSON.stringify(after.map((p) => [p.slug, p.role, p.matchCount])))
const unknownProjects = await call("GET", "/users/00000000-0000-4000-8000-000000000000/projects")
check("projects for an unknown user is not found", unknownProjects.status === 404, detail(unknownProjects))

await resetDemo()
await db.end()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
