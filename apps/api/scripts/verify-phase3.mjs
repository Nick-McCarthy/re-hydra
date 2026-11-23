// End-to-end checks for audit phase 3: I3 constraint, A-008, A-009, A-016,
// A-022, A-023, and the board query.
//
// Needs a running API and matchd, a database migrated through 012 and seeded,
// and the `scale100k` project from the phase 3 notes. Never point it at a
// database you care about: it changes project settings and resets rows.
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   node apps/api/scripts/verify-phase3.mjs
import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const pg = require("pg")

const API = process.env.AUDIT_API ?? "http://localhost:3100/v1"
const DATABASE_URL = process.env.AUDIT_DATABASE_URL
if (!DATABASE_URL || !/audit|test/.test(DATABASE_URL)) {
  console.error("Set AUDIT_DATABASE_URL to a throwaway database whose name contains 'audit' or 'test'.")
  process.exit(2)
}

const db = new pg.Client({ connectionString: DATABASE_URL })
await db.connect()
const one = async (text, params) => (await db.query(text, params)).rows[0]

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
}

const call = async (method, path, token, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, body: json }
}
const ok = (status) => status >= 200 && status < 300

const until = async (what, fn, ms = 60_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timed out waiting for ${what}`)
}

// Throwaway accounts on the local test API. The password is random and never stored.
const signUp = async (label) => {
  const email = `audit-${label}-${randomBytes(4).toString("hex")}@example.test`
  const res = await call("POST", "/auth/sign-up", undefined, {
    email, displayName: `Audit ${label}`, password: randomBytes(18).toString("base64url")
  })
  if (!ok(res.status)) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`)
  return res.body.token
}

const dev = await call("POST", "/auth/sign-in", undefined, { email: "dev@re-hydra.local", password: "rehydra-dev" })
if (!ok(dev.status)) throw new Error(`sign-in failed: ${dev.status}`)
const devToken = dev.body.token

const scale = await one(`SELECT id, max_held_chunks, max_concurrent_leases FROM projects WHERE slug = 'scale100k'`)
if (!scale) throw new Error("scale100k project missing; load it first (see docs/audit/phase-3.md)")

// --- I3: the database refuses a second unfinished interactive job per chunk.
{
  const a = await one(`SELECT a.id, a.chunk_id, c.project_id, c.bytes_sha256 FROM attempts a JOIN chunks c ON c.id = a.chunk_id LIMIT 1`)
  await db.query("BEGIN")
  const insert = () => db.query(`
    INSERT INTO jobs (project_id, chunk_id, attempt_id, kind, state, priority, toolchain, language, entry_symbol, original_sha256, sources)
    VALUES ($1, $2, $3, 'interactive', 'queued', 10, '{}', 'c', 'x', $4, '[]')`, [a.project_id, a.chunk_id, a.id, a.bytes_sha256])
  await db.query(`DELETE FROM jobs WHERE chunk_id = $1 AND kind = 'interactive' AND state IN ('queued','claimed')`, [a.chunk_id])
  await insert()
  let code = null
  try { await insert() } catch (e) { code = e.code }
  await db.query("ROLLBACK")
  check("I3 a second queued interactive job for one chunk is refused", code === "23505", `sqlstate ${code}`)
}

// --- A-008: parallel checkouts cannot exceed max_held_chunks.
const u1 = await signUp("u1")
const u2 = await signUp("u2")
const u3 = await signUp("u3")
await db.query(`UPDATE projects SET max_held_chunks = 2, max_concurrent_leases = 2 WHERE id = $1`, [scale.id])
let heldChunk
{
  const open = (await db.query(`SELECT id FROM chunks WHERE project_id = $1 AND state = 'open' AND fuse_parent_id IS NULL ORDER BY address LIMIT 6`, [scale.id])).rows
  const tries = await Promise.all(open.map((c) => call("POST", `/projects/scale100k/chunks/${c.id}/checkout`, u1)))
  const won = tries.filter((r) => ok(r.status))
  check("A-008 six parallel checkouts with max_held_chunks=2 grant exactly 2", won.length === 2,
    `granted ${won.length}, statuses ${tries.map((r) => r.status).join(",")}`)
  heldChunk = won[0]?.body?.chunk?.id
}

// --- A-009: two users racing for the last extra lease slot get one.
{
  const both = await Promise.all([
    call("POST", `/projects/scale100k/chunks/${heldChunk}/checkout`, u2),
    call("POST", `/projects/scale100k/chunks/${heldChunk}/checkout`, u3)
  ])
  const won = both.filter((r) => ok(r.status)).length
  const sides = await one(`SELECT COUNT(*)::int AS n FROM chunk_leases WHERE chunk_id = $1 AND released_at IS NULL`, [heldChunk])
  check("A-009 two racers for one extra slot (cap 2) get one lease", won === 1 && sides.n === 1,
    `granted ${won}, active extra leases ${sides.n}`)
}

// Restore the scale project and drop its test leases.
const cleanupScale = async () => {
  await db.query(`UPDATE projects SET max_held_chunks = $2, max_concurrent_leases = $3 WHERE id = $1`,
    [scale.id, scale.max_held_chunks, scale.max_concurrent_leases])
  await db.query(`DELETE FROM chunk_leases WHERE chunk_id IN (SELECT id FROM chunks WHERE project_id = $1)`, [scale.id])
  await db.query(`
    UPDATE chunks SET state = 'open', lease_user_id = NULL, lease_token = NULL, lease_expires_at = NULL, hold_started_at = NULL
    WHERE project_id = $1 AND state = 'leased' AND lease_user_id IN (SELECT id FROM users WHERE email LIKE 'audit-%@example.test')`, [scale.id])
}
await cleanupScale()

// --- Board page on 100k chunks goes through chunks_board_idx.
{
  const t0 = performance.now()
  const res = await call("GET", "/projects/scale100k/chunks?limit=100", devToken)
  const ms = performance.now() - t0
  check("board page on a 100k-chunk project returns 100 rows", ok(res.status) && Array.isArray(res.body) && res.body.length === 100,
    `${res.status}, ${Math.round(ms)} ms round trip`)
}

// --- Demo chunk helpers for A-022, A-023, A-016.
const demo = await one(`SELECT c.id, c.project_id FROM chunks c JOIN projects p ON p.id = c.project_id WHERE p.slug = 'demo' AND c.fuse_parent_id IS NULL LIMIT 1`)
const reset = async () => {
  await db.query(`DELETE FROM recipe_jobs WHERE chunk_id = $1`, [demo.id])
  await db.query(`DELETE FROM jobs WHERE chunk_id = $1`, [demo.id])
  await db.query(`UPDATE chunks SET current_match_id = NULL, best_attempt_id = NULL WHERE id = $1`, [demo.id])
  await db.query(`DELETE FROM matches WHERE chunk_id = $1`, [demo.id])
  await db.query(`DELETE FROM attempts WHERE chunk_id = $1`, [demo.id])
  await db.query(`DELETE FROM chunk_leases WHERE chunk_id = $1`, [demo.id])
  await db.query(`UPDATE chunks SET state = 'open', lease_user_id = NULL, lease_token = NULL, lease_expires_at = NULL, hold_started_at = NULL WHERE id = $1`, [demo.id])
}
const checkout = async () => {
  const res = await call("POST", `/projects/demo/chunks/${demo.id}/checkout`, devToken)
  if (!ok(res.status)) throw new Error(`checkout failed: ${res.status}`)
  return res.body.leaseToken
}
const submit = (lease, source) => call("POST", `/projects/demo/chunks/${demo.id}/submit`, devToken, { leaseToken: lease, source })
const state = async () => (await one(`SELECT state FROM chunks WHERE id = $1`, [demo.id])).state
const settle = () => until("chunk to leave validating", async () => (await state()) !== "validating")
const MISS = "int parse_header(void) { return 12345; }\n"
const HIT = "void parse_header(void) {}\n"
await reset()

// --- A-023: a miss extends the lease.
{
  const lease = await checkout()
  const sent = await submit(lease, MISS)
  // Hold the job row so the worker cannot claim it until the lease is shortened.
  await db.query("BEGIN")
  const job = await one(`SELECT id, state FROM jobs WHERE attempt_id = $1 FOR UPDATE`, [sent.body.attemptId])
  await db.query(`UPDATE chunks SET lease_expires_at = now() + interval '1 minute' WHERE id = $1`, [demo.id])
  await db.query("COMMIT")
  if (job.state !== "queued") {
    check("A-023 a miss extends a nearly expired lease", false, `job was already ${job.state}; rerun`)
  } else {
    await settle()
    const row = await one(`SELECT state, lease_expires_at > now() + interval '1 hour' AS extended FROM chunks WHERE id = $1`, [demo.id])
    check("A-023 a miss extends a nearly expired lease", row.state === "leased" && row.extended === true, `state ${row.state}`)
  }
}

// --- A-022: a recipe recheck only touches the match it was queued for.
{
  const lease = (await one(`SELECT lease_token FROM chunks WHERE id = $1`, [demo.id])).lease_token
  const older = await one(`SELECT id FROM attempts WHERE chunk_id = $1 ORDER BY created_at LIMIT 1`, [demo.id])
  const hit = await submit(lease, HIT)
  await settle()
  const matched = await state()
  const recipe = async (attemptId) => {
    const c = await one(`SELECT c.bytes_sha256, c.name, p.toolchain FROM chunks c JOIN projects p ON p.id = c.project_id WHERE c.id = $1`, [demo.id])
    const toolchain = { ...c.toolchain, flags: ["-O0"] }
    const row = await one(`
      INSERT INTO recipe_jobs (project_id, chunk_id, attempt_id, language, toolchain, entry_symbol, original_sha256)
      VALUES ($1, $2, $3, 'c', $4, $5, $6) RETURNING id`, [demo.project_id, demo.id, attemptId, toolchain, c.name, c.bytes_sha256])
    return until("recipe recheck to finish", async () => {
      const r = await one(`SELECT state, result FROM recipe_jobs WHERE id = $1`, [row.id])
      return r.state === "succeeded" || r.state === "failed" ? r : undefined
    })
  }
  const stale = await recipe(older.id)
  const afterStale = await one(`SELECT c.state, (SELECT COUNT(*)::int FROM matches m WHERE m.chunk_id = c.id AND m.invalidated_at IS NULL) AS active FROM chunks c WHERE c.id = $1`, [demo.id])
  check("A-022 a recheck for an older attempt leaves the current match alone",
    matched === "matched" && afterStale.state === "matched" && afterStale.active === 1,
    `recheck ${stale.state}, chunk ${afterStale.state}, active matches ${afterStale.active}`)
  const current = await recipe(hit.body.attemptId)
  const afterCurrent = await one(`SELECT c.state, (SELECT COUNT(*)::int FROM matches m WHERE m.chunk_id = c.id AND m.invalidated_at IS NULL) AS active FROM chunks c WHERE c.id = $1`, [demo.id])
  check("A-022 a missing recheck for the current match makes the chunk stale (control)",
    afterCurrent.state === "stale" && afterCurrent.active === 0,
    `recheck ${current.state}, chunk ${afterCurrent.state}, active matches ${afterCurrent.active}`)
}

// --- A-016: the sweeper repairs stale board counts.
{
  await db.query(`UPDATE project_chunk_stats SET open_count = total_count, leased_count = 0, validating_count = 0, matched_count = 0, stale_count = 0, blocked_count = 0 WHERE project_id = $1`, [demo.project_id])
  await db.query(`UPDATE chunks SET updated_at = now() WHERE id = $1`, [demo.id])
  const repaired = await until("sweeper to repair counts", async () => {
    const s = await one(`SELECT open_count, stale_count FROM project_chunk_stats WHERE project_id = $1`, [demo.project_id])
    const real = await one(`SELECT COUNT(*) FILTER (WHERE state = 'open')::int AS open, COUNT(*) FILTER (WHERE state = 'stale')::int AS stale FROM chunks WHERE project_id = $1 AND fuse_parent_id IS NULL`, [demo.project_id])
    return s.open_count === real.open && s.stale_count === real.stale ? s : undefined
  }, 45_000).catch(() => undefined)
  check("A-016 corrupted board counts are repaired by the sweeper within 45 s", repaired !== undefined)
}

await reset()
await db.query(`DELETE FROM users WHERE email LIKE 'audit-%@example.test'
  AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.user_id = users.id)`).catch(() => {})
await db.end()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
