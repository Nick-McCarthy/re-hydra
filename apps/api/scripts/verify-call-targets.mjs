// End-to-end checks for audit A-007 (call targets) on the seeded `link`
// project: leaf at 0x401000, caller at 0x401040 (calls leaf), decoy at
// 0x401080 (same shape as caller).
//
// Needs an API with RATE_LIMITS=off on a throwaway seeded database, and the
// compose matchd built from this commit.
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   node apps/api/scripts/verify-call-targets.mjs
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const pg = require("pg")

const API = process.env.AUDIT_API ?? "http://localhost:3100/v1"
const MATCHD = "http://127.0.0.1:3001"
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
const lastLine = (s) => String(s ?? "").trim().split("\n").pop().slice(0, 160)

const token = (await call("POST", "/auth/sign-in", undefined, { email: "dev@re-hydra.local", password: "rehydra-dev" })).body.token
const caller = await one(`SELECT c.id FROM chunks c JOIN projects p ON p.id = c.project_id WHERE p.slug = 'link' AND c.name = 'caller'`)
const reset = async () => {
  await db.query(`DELETE FROM jobs WHERE chunk_id = $1`, [caller.id])
  await db.query(`UPDATE chunks SET current_match_id = NULL, best_attempt_id = NULL WHERE id = $1`, [caller.id])
  await db.query(`DELETE FROM matches WHERE chunk_id = $1`, [caller.id])
  await db.query(`DELETE FROM attempts WHERE chunk_id = $1`, [caller.id])
  await db.query(`UPDATE chunks SET state = 'open', lease_user_id = NULL, lease_token = NULL, lease_expires_at = NULL, hold_started_at = NULL WHERE id = $1`, [caller.id])
}
await reset()

const lease = (await call("POST", `/projects/link/chunks/${caller.id}/checkout`, token)).body.leaseToken
const bundle = (await call("GET", `/projects/link/chunks/${caller.id}/bundle`, token)).body

const DECOY = "int caller(int x) { return decoy(x) + 1; }\n"
const OTHER = "int other(int x);\nint caller(int x) { return other(x) + 1; }\n"
const HONEST = "int caller(int x) { return leaf(x) + 1; }\n"

// Before A-007 the masked bytes alone could not tell these apart. Show that,
// by asking matchd without the original's address.
{
  const res = await fetch(`${MATCHD}/v1/jobs`, {
    method: "POST",
    headers: { authorization: "Bearer dev-matchd-token", "content-type": "application/json" },
    body: JSON.stringify({
      jobId: "decoy-bytes", arch: "x86_64", language: "c",
      toolchain: { compiler: "gcc", version: "12", flags: ["-O2"], image: "ghcr.io/re-hydra/gcc:host" }, flags: ["-O2"],
      entrySymbol: "caller", originalBytesBase64: bundle.originalBytesBase64,
      sources: [{ path: "candidate.c", text: DECOY }, { path: "types.h", text: bundle.types }]
    })
  }).then((r) => r.json())
  check("the decoy's masked bytes alone are a match (why A-007 was needed)", res.matched === true, `matched=${res.matched}`)
}

const submit = async (source) => {
  const sent = await call("POST", `/projects/link/chunks/${caller.id}/submit`, token, { leaseToken: lease, source })
  await until("chunk to leave validating", async () => (await one(`SELECT state FROM chunks WHERE id = $1`, [caller.id])).state !== "validating")
  return one(`SELECT matched, diagnostics FROM attempts WHERE id = $1`, [sent.body.attemptId])
}

const decoy = await submit(DECOY)
check("A-007: calling decoy where the original calls leaf is refused", decoy.matched === false && /calls decoy .* original calls leaf/.test(decoy.diagnostics ?? ""), lastLine(decoy.diagnostics))
const other = await submit(OTHER)
check("A-007: calling an outside function where the original calls leaf is refused", other.matched === false && /calls other .* original calls leaf/.test(other.diagnostics ?? ""), lastLine(other.diagnostics))
const honest = await submit(HONEST)
const state = (await one(`SELECT state FROM chunks WHERE id = $1`, [caller.id])).state
check("A-007: the honest translation calling leaf still matches", honest.matched === true && state === "matched", `matched=${honest.matched}, chunk ${state}`)

await reset()
await db.end()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
