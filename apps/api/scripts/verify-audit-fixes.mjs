// End-to-end check for audit findings A-001 to A-005.
//
// Needs a running API, matchd, and a seeded database it can reset rows in.
// Never point it at a database you care about.
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   node apps/api/scripts/verify-audit-fixes.mjs
//
// The dev user and password come from `npm run api:seed`.
import { createHash, randomUUID } from "node:crypto"
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

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
}

const call = async (method, path, token, body) => {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, body: json }
}

const until = async (what, fn, ms = 60_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timed out waiting for ${what}`)
}

const one = async (text, params) => (await db.query(text, params)).rows[0]

const signIn = await call("POST", "/auth/sign-in", undefined, {
  email: "dev@re-hydra.local",
  password: "rehydra-dev"
})
if (signIn.status !== 200 && signIn.status !== 201) throw new Error(`sign-in failed: ${signIn.status}`)
const token = signIn.body.token

const demo = await one(`
  SELECT c.id, c.project_id FROM chunks c
  INNER JOIN projects p ON p.id = c.project_id
  WHERE p.slug = 'demo' AND c.fuse_parent_id IS NULL LIMIT 1`)

// Reset the demo chunk so the script can run more than once.
const reset = async () => {
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
await reset()

const checkout = async () => {
  const res = await call("POST", `/projects/demo/chunks/${demo.id}/checkout`, token)
  if (res.status !== 200 && res.status !== 201) throw new Error(`checkout failed: ${res.status} ${JSON.stringify(res.body)}`)
  return res.body.leaseToken
}
const submit = (leaseToken, source) =>
  call("POST", `/projects/demo/chunks/${demo.id}/submit`, token, { leaseToken, source })
const chunkState = async () => (await one(`SELECT state FROM chunks WHERE id = $1`, [demo.id])).state
const settle = () => until("chunk to leave validating", async () => (await chunkState()) !== "validating")

const MISS = "int parse_header(void) { return 12345; }\n"
const HIT = "void parse_header(void) {}\n"

// A-002: one submission in flight per chunk.
{
  const lease = await checkout()
  const first = await submit(lease, MISS)
  const second = await submit(lease, MISS + "/* different */\n")
  const again = await submit(lease, MISS)
  const raced = (await chunkState()) !== "validating" && second.status < 300
  if (raced) {
    check("A-002 second submit while validating is refused", false, "the first job finished before the second submit; rerun")
  } else {
    check("A-002 second submit while validating is refused", second.status === 409, `status ${second.status}`)
  }
  check("A-002 same bytes under the same lease return the same attempt",
    again.status < 300 && again.body.attemptId === first.body.attemptId, `status ${again.status}`)
  await settle()
  const jobs = await one(`SELECT COUNT(*)::int AS n FROM jobs WHERE chunk_id = $1`, [demo.id])
  check("A-002 only one job was queued", jobs.n === 1, `${jobs.n} jobs`)
  check("A-002 a miss returns the chunk to its holder", (await chunkState()) === "leased")
}

// A-001: a result for an attempt the chunk is no longer validating writes no match.
{
  const lease = (await one(`SELECT lease_token FROM chunks WHERE id = $1`, [demo.id])).lease_token
  const hit = await submit(lease, HIT)
  // Simulate the race: the lease moves on before the job runs. Hand the chunk
  // a new token while the job is still queued, holding the row so the worker
  // cannot claim first.
  await db.query("BEGIN")
  await db.query(`SELECT id FROM jobs WHERE attempt_id = $1 FOR UPDATE`, [hit.body.attemptId])
  const queued = await one(`SELECT state FROM jobs WHERE attempt_id = $1`, [hit.body.attemptId])
  await db.query(`UPDATE chunks SET state = 'leased', lease_token = $2 WHERE id = $1`, [demo.id, randomUUID()])
  await db.query("COMMIT")
  if (queued.state !== "queued") {
    check("A-001 stale result writes no match", false, `job was already ${queued.state}; rerun`)
  } else {
    await until("job to finish", async () => {
      const row = await one(`SELECT state FROM jobs WHERE attempt_id = $1`, [hit.body.attemptId])
      return row.state === "succeeded" || row.state === "failed"
    })
    const matches = await one(`SELECT COUNT(*)::int AS n FROM matches WHERE chunk_id = $1`, [demo.id])
    const attempt = await one(`SELECT matched FROM attempts WHERE id = $1`, [hit.body.attemptId])
    check("A-001 stale result writes no match", matches.n === 0, `${matches.n} match rows`)
    check("A-001 the attempt still records its own score", attempt.matched === true)
    check("A-001 the chunk is left as the newer lease set it", (await chunkState()) === "leased")
  }
}

// A-001: a fresh lease can still match, and a rerun of the same job applies once.
{
  await reset()
  const lease = await checkout()
  const hit = await submit(lease, HIT)
  await settle()
  check("A-001 a matching submit marks the chunk matched", (await chunkState()) === "matched")
  // Replay the finished job as if its claim had expired mid-compile.
  await db.query(`
    UPDATE jobs SET state = 'claimed', claim_expires_at = now() - interval '1 second', finished_at = NULL
    WHERE attempt_id = $1`, [hit.body.attemptId])
  await until("replayed job to finish", async () => {
    const row = await one(`SELECT state FROM jobs WHERE attempt_id = $1`, [hit.body.attemptId])
    return row.state !== "claimed"
  })
  const matches = await one(`SELECT COUNT(*)::int AS n FROM matches WHERE chunk_id = $1`, [demo.id])
  const job = await one(`SELECT state FROM jobs WHERE attempt_id = $1`, [hit.body.attemptId])
  check("A-001 a replayed job does not loop or add a second match",
    matches.n === 1 && (job.state === "succeeded" || job.state === "failed"), `${matches.n} matches, job ${job.state}`)
}

// A-004: a job whose source blob is gone hands the chunk back.
{
  await reset()
  const lease = await checkout()
  const ghost = createHash("sha256").update(randomUUID()).digest()
  await db.query(`INSERT INTO blobs (sha256, size_bytes, content_type) VALUES ($1, 1, 'text/x-c')`, [ghost])
  const chunk = await one(`
    SELECT c.type_revision_id, c.bytes_sha256, c.name, p.toolchain, p.language
    FROM chunks c INNER JOIN projects p ON p.id = c.project_id WHERE c.id = $1`, [demo.id])
  const user = await one(`SELECT lease_user_id FROM chunks WHERE id = $1`, [demo.id])
  const attempt = await one(`
    INSERT INTO attempts (chunk_id, user_id, lease_token, source_sha256, type_revision_id, language)
    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [demo.id, user.lease_user_id, lease, ghost, chunk.type_revision_id, chunk.language])
  await db.query(`UPDATE chunks SET state = 'validating' WHERE id = $1`, [demo.id])
  await db.query(`
    INSERT INTO jobs (project_id, chunk_id, attempt_id, kind, state, priority, toolchain,
      language, entry_symbol, original_sha256, sources)
    VALUES ($1, $2, $3, 'interactive', 'queued', 10, $4, $5, $6, $7, '[]')`,
    [demo.project_id, demo.id, attempt.id, chunk.toolchain, chunk.language, chunk.name, chunk.bytes_sha256])
  await settle()
  const job = await one(`SELECT state FROM jobs WHERE attempt_id = $1`, [attempt.id])
  const scored = await one(`SELECT diagnostics, finished_at FROM attempts WHERE id = $1`, [attempt.id])
  check("A-004 missing source fails the job", job.state === "failed", job.state)
  check("A-004 the chunk returns to its holder", (await chunkState()) === "leased")
  check("A-004 the attempt says why", scored.finished_at !== null && /source blob missing/.test(scored.diagnostics ?? ""))
}

// A-005: a recheck whose compile fails still finishes the proposal.
{
  await reset()
  const lease = await checkout()
  const broken = await submit(lease, "#error audit A-005\n")
  await settle()
  const brokenAttempt = await one(`SELECT compiler_ok FROM attempts WHERE id = $1`, [broken.body.attemptId])
  const chunk = await one(`
    SELECT c.type_revision_id, c.bytes_sha256, c.name, p.toolchain, p.language, tr.headers_sha256
    FROM chunks c INNER JOIN projects p ON p.id = c.project_id
    INNER JOIN type_revisions tr ON tr.id = c.type_revision_id WHERE c.id = $1`, [demo.id])
  const owner = await one(`SELECT id FROM users WHERE email = 'dev@re-hydra.local'`)
  const proposal = await one(`
    INSERT INTO type_proposals (project_id, base_revision_id, headers_sha256, title, state,
      created_by, revalidation_total)
    VALUES ($1, $2, $3, 'audit A-005', 'revalidating', $4, 1) RETURNING id`,
    [demo.project_id, chunk.type_revision_id, chunk.headers_sha256, owner.id])
  await db.query(`
    INSERT INTO jobs (project_id, chunk_id, attempt_id, proposal_id, kind, state, priority, toolchain,
      language, entry_symbol, original_sha256, sources)
    VALUES ($1, $2, $3, $4, 'revalidation', 'queued', 100, $5, $6, $7, $8, '[]')`,
    [demo.project_id, demo.id, broken.body.attemptId, proposal.id, chunk.toolchain, chunk.language,
      chunk.name, chunk.bytes_sha256])
  const landed = await until("proposal to leave revalidating", async () => {
    const row = await one(`SELECT state, revalidation_done, revalidation_failed FROM type_proposals WHERE id = $1`, [proposal.id])
    return row.state !== "revalidating" ? row : undefined
  }, 30_000).catch(() => undefined)
  check("A-005 the broken source really fails to compile", brokenAttempt.compiler_ok === false)
  check("A-005 a failed recheck compile still finishes the proposal", landed !== undefined,
    landed ? `state ${landed.state}, done ${landed.revalidation_done}` : "stuck in revalidating")
  await db.query(`DELETE FROM jobs WHERE proposal_id = $1`, [proposal.id])
}

await reset()
await db.end()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
