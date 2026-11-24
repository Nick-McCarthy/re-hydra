// End-to-end checks for the audit's small fixes: A-033, A-010, A-014, A-015,
// A-026, A-028. (A-018 needs two API processes and is checked separately in
// the change log; A-038 is a file-mode change checked on Linux.)
//
// Needs an API with RATE_LIMITS=off on a throwaway database (seeded, with the
// scale100k project), and the compose matchd container. The A-015 check stops
// and restarts that container.
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   node apps/api/scripts/verify-small-fixes.mjs
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const pg = require("pg")

const API = process.env.AUDIT_API ?? "http://localhost:3100/v1"
const MATCHD = "http://127.0.0.1:3001"
const MATCHD_CONTAINER = process.env.AUDIT_MATCHD_CONTAINER ?? "re-hydra-matchd-1"
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
const until = async (what, fn, ms = 60_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const value = await fn()
    if (value) return value
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timed out waiting for ${what}`)
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
const firstLine = (s) => String(s ?? "").split("\n")[0].slice(0, 140)

// --- A-033: includes outside the job are refused without echoing the file.
{
  const job = (source) => ({
    jobId: "inc", arch: "x86_64", language: "c",
    toolchain: { compiler: "gcc", version: "x", flags: ["-O2"], image: "ghcr.io/re-hydra/gcc:4.8.5@sha256:dev" }, flags: ["-O2"],
    entrySymbol: "parse_header", originalBytesBase64: Buffer.from([0xc3]).toString("base64"),
    sources: [{ path: "candidate.c", text: source }, { path: "types.h", text: "/* empty */\n" }]
  })
  const post = async (source) => (await fetch(`${MATCHD}/v1/jobs`, {
    method: "POST", headers: { authorization: "Bearer dev-matchd-token", "content-type": "application/json" }, body: JSON.stringify(job(source))
  })).json()
  const hostname = docker("exec", MATCHD_CONTAINER, "cat", "/etc/hostname")
  const etc = await post('#include "/etc/hostname"\nvoid parse_header(void) {}\n')
  check("A-033: #include of /etc/hostname is refused and the file is not shown",
    /outside the job: \/etc\/hostname/.test(etc.diagnostics) && !etc.diagnostics.includes(hostname), firstLine(etc.diagnostics))
  const macro = await post('#define P "/etc/passwd"\n#include P\nvoid parse_header(void) {}\n')
  check("A-033: an include path built by a macro is refused", /outside the job: \/etc\/passwd/.test(macro.diagnostics) && !/root:x:0/.test(macro.diagnostics), firstLine(macro.diagnostics))
  const dotdot = await post('#include "../../etc/passwd"\nvoid parse_header(void) {}\n')
  check("A-033: a relative path that climbs out is refused", /outside the job/.test(dotdot.diagnostics) && !/root:x:0/.test(dotdot.diagnostics), firstLine(dotdot.diagnostics))
  const system = await post("#include <stddef.h>\n#include <string.h>\nvoid parse_header(void) {}\n")
  check("A-033: system headers still work", system.compilerOk === true && system.matched === true, firstLine(system.diagnostics))
}

const token = (await call("POST", "/auth/sign-in", undefined, { email: "dev@re-hydra.local", password: "rehydra-dev" })).body.token
const demo = await one(`SELECT c.id, c.project_id FROM chunks c JOIN projects p ON p.id = c.project_id WHERE p.slug = 'demo' AND c.fuse_parent_id IS NULL LIMIT 1`)
const reset = async () => {
  await db.query(`DELETE FROM recipe_jobs WHERE chunk_id = $1`, [demo.id])
  await db.query(`DELETE FROM jobs WHERE chunk_id = $1`, [demo.id])
  await db.query(`UPDATE chunks SET current_match_id = NULL, best_attempt_id = NULL, allow_inline_asm = false WHERE id = $1`, [demo.id])
  await db.query(`DELETE FROM matches WHERE chunk_id = $1`, [demo.id])
  await db.query(`DELETE FROM attempts WHERE chunk_id = $1`, [demo.id])
  await db.query(`DELETE FROM chunk_leases WHERE chunk_id = $1`, [demo.id])
  await db.query(`UPDATE chunks SET state = 'open', lease_user_id = NULL, lease_token = NULL, lease_expires_at = NULL, hold_started_at = NULL WHERE id = $1`, [demo.id])
}
const checkout = async () => (await call("POST", `/projects/demo/chunks/${demo.id}/checkout`, token)).body.leaseToken
const state = async () => (await one(`SELECT state FROM chunks WHERE id = $1`, [demo.id])).state
const settle = (ms) => until("chunk to leave validating", async () => (await state()) !== "validating", ms)
await reset()

// --- A-010: an expired lease cannot heartbeat or submit, even before the sweep.
{
  const lease = await checkout()
  await db.query(`UPDATE chunks SET lease_expires_at = now() - interval '1 second' WHERE id = $1`, [demo.id])
  const hb = await call("POST", `/projects/demo/chunks/${demo.id}/heartbeat`, token, { leaseToken: lease })
  const sub = await call("POST", `/projects/demo/chunks/${demo.id}/submit`, token, { leaseToken: lease, source: "void parse_header(void) {}\n" })
  check("A-010: heartbeat on an expired, unswept lease is refused", hb.status === 409, `status ${hb.status}`)
  check("A-010: submit on an expired, unswept lease is refused", sub.status === 409, `status ${sub.status}`)
  await reset()
}

// --- A-014: a missing headers blob fails the job with the reason.
{
  const lease = await checkout()
  const rev = await one(`SELECT c.type_revision_id, tr.headers_sha256 FROM chunks c JOIN type_revisions tr ON tr.id = c.type_revision_id WHERE c.id = $1`, [demo.id])
  // Point the revision at a registered blob with no stored bytes, for this run only.
  const ghost = Buffer.alloc(32, 7)
  await db.query(`INSERT INTO blobs (sha256, size_bytes, content_type) VALUES ($1, 1, 'text/plain') ON CONFLICT DO NOTHING`, [ghost])
  await db.query(`UPDATE type_revisions SET headers_sha256 = $2 WHERE id = $1`, [rev.type_revision_id, ghost])
  const sent = await call("POST", `/projects/demo/chunks/${demo.id}/submit`, token, { leaseToken: lease, source: "void parse_header(void) {}\n" })
  await settle()
  await db.query(`UPDATE type_revisions SET headers_sha256 = $2 WHERE id = $1`, [rev.type_revision_id, rev.headers_sha256])
  const a = await one(`SELECT matched, diagnostics FROM attempts WHERE id = $1`, [sent.body.attemptId])
  check("A-014: a missing headers blob fails the job with the reason instead of compiling against an empty header",
    a.matched === false && /type headers blob missing/.test(a.diagnostics ?? ""), firstLine(a.diagnostics))
  await reset()
}

// --- A-015: with matchd down, a job waits and retries instead of becoming a miss.
{
  const lease = await checkout()
  docker("stop", MATCHD_CONTAINER)
  try {
    const sent = await call("POST", `/projects/demo/chunks/${demo.id}/submit`, token, { leaseToken: lease, source: "void parse_header(void) {}\n" })
    const requeued = await until("job to be requeued", async () => {
      const j = await one(`SELECT state, transport_retries, not_before > now() AS waiting FROM jobs WHERE attempt_id = $1`, [sent.body.attemptId])
      return j.transport_retries >= 1 ? j : undefined
    }, 60_000)
    const a = await one(`SELECT finished_at FROM attempts WHERE id = $1`, [sent.body.attemptId])
    check("A-015: matchd down puts the job back with a backoff, and no miss is recorded",
      requeued.state === "queued" && requeued.waiting === true && a.finished_at === null && (await state()) === "validating",
      `job ${requeued.state}, tries ${requeued.transport_retries}, chunk ${await state()}`)
    docker("start", MATCHD_CONTAINER)
    await until("matchd to come back", async () => { try { return (await fetch(`${MATCHD}/v1/health`)).ok } catch { return false } }, 60_000)
    // Skip the rest of the backoff so the check does not wait minutes.
    await db.query(`UPDATE jobs SET not_before = now() WHERE attempt_id = $1`, [sent.body.attemptId])
    await settle(60_000)
    check("A-015: once matchd is back, the same job runs and the chunk matches", (await state()) === "matched", await state())
  } finally {
    try { docker("start", MATCHD_CONTAINER) } catch {}
  }
}

// --- A-026: a recheck whose compile fails is counted as unchecked.
// The demo chunk is matched after the A-015 check. A proposal whose header is
// not valid C makes its recheck fail to compile: the match stays, and the
// recheck must be counted as unchecked, not as passed.
{
  // With one reviewer the proposal lands by itself, making the broken header
  // the current revision. Note the revision so it can be put back after.
  const before = await one(`SELECT type_revision_id FROM chunks WHERE id = $1`, [demo.id])
  const restore = async (proposalId) => {
    const landed = await one(`SELECT resulting_revision_id FROM type_proposals WHERE id = $1`, [proposalId])
    await db.query(`UPDATE chunks SET type_revision_id = $2 WHERE project_id = $1 AND type_revision_id IS NOT NULL`, [demo.project_id, before.type_revision_id])
    await db.query(`UPDATE matches SET type_revision_id = $2 WHERE chunk_id IN (SELECT id FROM chunks WHERE project_id = $1)`, [demo.project_id, before.type_revision_id])
    if (landed?.resulting_revision_id) {
      await db.query(`UPDATE type_proposals SET resulting_revision_id = NULL WHERE id = $1`, [proposalId])
      await db.query(`DELETE FROM type_revisions WHERE id = $1`, [landed.resulting_revision_id])
    }
  }
  const created = await call("POST", "/projects/demo/type-proposals", token, {
    title: "audit A-026 broken header",
    headers: "this is not valid C at all;\n"
  })
  const proposalId = created.body.id
  const started = await call("POST", `/projects/demo/type-proposals/${proposalId}/revalidate`, token)
  const done = await until("proposal to finish", async () => {
    const row = await one(`SELECT state, revalidation_total, revalidation_done, revalidation_failed, revalidation_unchecked FROM type_proposals WHERE id = $1`, [proposalId])
    return row.state !== "revalidating" ? row : undefined
  }, 90_000).catch(() => undefined)
  check("A-026: a recheck that cannot compile counts as unchecked, not passed",
    created.status === 201 && started.status < 300 && done !== undefined &&
      done.revalidation_unchecked >= 1 && done.revalidation_done === 0 && done.revalidation_failed === 0,
    done ? `total ${done.revalidation_total}, done ${done.revalidation_done}, failed ${done.revalidation_failed}, unchecked ${done.revalidation_unchecked}, state ${done.state}` : `create ${created.status}, start ${started.status}, stuck`)
  const api = (await call("GET", `/projects/demo/type-proposals/${proposalId}`)).body
  check("A-026: the API reports the unchecked count", api.revalidationUnchecked === done?.revalidation_unchecked, `revalidationUnchecked ${api.revalidationUnchecked}`)
  await restore(proposalId)
}

// --- A-028: board search on the 100k project is fast and finds the function.
{
  const t0 = performance.now()
  const res = await call("GET", "/projects/scale100k/chunks?q=fn_4242&limit=100")
  const ms = Math.round(performance.now() - t0)
  check("A-028: board search on 100,000 chunks finds fn_4242", res.status === 200 && res.body.some((c) => c.name === "fn_4242"), `${ms} ms round trip, ${res.body.length} rows`)
}

await reset()
await db.end()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)

function docker(...args) {
  return execFileSync("docker", args, { encoding: "utf8" }).trim()
}
