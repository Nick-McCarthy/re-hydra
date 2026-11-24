// End-to-end checks for audit A-032 (inline assembly).
//
// Needs a running API and matchd built from this commit, and a throwaway
// database migrated through 013 and seeded. MATCHD_URLS lists extra matchd
// processes to probe as image=url pairs (for example the GameCube and Switch
// images on temporary ports).
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   AUDIT_MATCHD=http://127.0.0.1:3001 AUDIT_MATCHD_TOKEN=dev-matchd-token \
//   node apps/api/scripts/verify-inline-asm.mjs
import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const pg = require("pg")

const API = process.env.AUDIT_API ?? "http://localhost:3100/v1"
const MATCHD = process.env.AUDIT_MATCHD ?? "http://127.0.0.1:3001"
const MATCHD_TOKEN = process.env.AUDIT_MATCHD_TOKEN ?? "dev-matchd-token"
const DATABASE_URL = process.env.AUDIT_DATABASE_URL
if (!DATABASE_URL || !/audit|test/.test(DATABASE_URL)) {
  console.error("Set AUDIT_DATABASE_URL to a throwaway database whose name contains 'audit' or 'test'.")
  process.exit(2)
}
const extraMatchd = (process.env.MATCHD_URLS ?? "").split(",").filter(Boolean).map((pair) => {
  const at = pair.lastIndexOf("=")
  return { image: pair.slice(0, at), url: pair.slice(at + 1) }
})

const db = new pg.Client({ connectionString: DATABASE_URL })
await db.connect()
const one = async (text, params) => (await db.query(text, params)).rows[0]
const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
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

// --- matchd directly -------------------------------------------------------
const HOST_IMAGE = "ghcr.io/re-hydra/gcc:4.8.5@sha256:dev"
const ORIGINAL = Buffer.from([0x48, 0xc7, 0xc0, 0x39, 0x30, 0x00, 0x00, 0xc3]) // mov rax,12345; ret
const FORGED = '__asm__(".text\\n.globl parse_header\\n.type parse_header,@function\\nparse_header:\\n.byte 0x48,0xc7,0xc0,0x39,0x30,0x00,0x00,0xc3\\n.size parse_header,.-parse_header\\n");\n'
const HONEST = "long parse_header(void) { return 12345; }\n"

const matchJob = async (url, { image = HOST_IMAGE, source, allow, flags = ["-O2"], original = ORIGINAL, arch = "x86_64" }) => {
  const res = await fetch(`${url}/v1/jobs`, {
    method: "POST",
    headers: { authorization: `Bearer ${MATCHD_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      jobId: `asm-${randomBytes(3).toString("hex")}`, arch, language: "c",
      toolchain: { compiler: "gcc", version: "x", flags, image }, flags,
      ...(allow === undefined ? {} : { allowInlineAsm: allow }),
      entrySymbol: "parse_header", originalBytesBase64: original.toString("base64"),
      sources: [{ path: "candidate.c", text: source }, { path: "types.h", text: "/* empty */\n" }]
    })
  })
  return res.json()
}
const refusedForAsm = (r) => r.matched === false && /inline assembly is not allowed/.test(r.diagnostics ?? "")

{
  const forged = await matchJob(MATCHD, { source: FORGED })
  check("matchd refuses the forged byte dump by default", refusedForAsm(forged), String(forged.diagnostics).split("\n")[0])
  const allowed = await matchJob(MATCHD, { source: FORGED, allow: true })
  check("with the chunk opt-in the same source matches and is marked", allowed.matched === true && allowed.usesInlineAsm === true,
    `matched=${allowed.matched} usesInlineAsm=${allowed.usesInlineAsm}`)
  const honest = await matchJob(MATCHD, { source: "long parse_header(void) { return 12345; }\n" })
  check("honest C compiles and reports no inline assembly", honest.compilerOk === true && honest.usesInlineAsm === false,
    `compilerOk=${honest.compilerOk} usesInlineAsm=${honest.usesInlineAsm}`)
  const withHeader = await matchJob(MATCHD, { source: "#include <string.h>\nlong parse_header(void) { return (long)strlen(\"asm\") + 12342; }\n" })
  check("system-header __asm__ and the word \"asm\" in a string are not flagged", withHeader.compilerOk === true && withHeader.usesInlineAsm === false,
    String(withHeader.diagnostics).split("\n")[0])
  const pasted = await matchJob(MATCHD, { source: "#define CAT(a, b) a ## b\n#define EMIT CAT(__as, m__)\nvoid parse_header(void) { EMIT(\"nop\"); }\n" })
  check("assembly built by token pasting in a macro is caught", refusedForAsm(pasted), String(pasted.diagnostics).split("\n")[0])
  const viaFlag = await matchJob(MATCHD, { source: "void parse_header(void) { EMIT(\"nop\"); }\n", flags: ["-O2", "-DEMIT=__asm__"] })
  check("assembly injected by a -D flag is caught", refusedForAsm(viaFlag), String(viaFlag.diagnostics).split("\n")[0])
}

// Link path: one unit with assembly, one without.
{
  const res = await fetch(`${MATCHD}/v1/link-jobs`, {
    method: "POST",
    headers: { authorization: `Bearer ${MATCHD_TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      jobId: "asm-link", arch: "x86_64", language: "c",
      toolchain: { compiler: "gcc", version: "x", flags: ["-O2"], image: HOST_IMAGE }, flags: ["-O2"],
      headers: "/* empty */\n",
      units: [
        { symbol: "parse_header", address: "0x401000", size: 8, originalBytesBase64: ORIGINAL.toString("base64"), source: FORGED },
        { symbol: "other", address: "0x401040", size: 6, originalBytesBase64: Buffer.from([0xb8, 0x39, 0x30, 0, 0, 0xc3]).toString("base64"), source: "long other(void) { return 12345; }\n" }
      ]
    })
  })
  const body = await res.json()
  const forgedUnit = (body.units ?? []).find((u) => u.symbol === "parse_header")
  check("the integration build refuses an assembly unit without the opt-in", /inline assembly is not allowed/.test(forgedUnit?.detail ?? ""),
    String(forgedUnit?.detail ?? JSON.stringify(body)).split("\n")[0])
}

// Other toolchains: the real preprocessor (clang) and the approximation (mwcc).
for (const target of extraMatchd) {
  const asmSource = "void parse_header(void) { asm(\"nop\"); }\n"
  const refused = await matchJob(target.url, { image: target.image, source: asmSource, arch: "other" })
  const honest = await matchJob(target.url, { image: target.image, source: "void parse_header(void) {}\n", arch: "other" })
  check(`${target.image}: asm is refused and plain C is not`, refusedForAsm(refused) && !refusedForAsm(honest) && honest.usesInlineAsm === false,
    `asm: ${String(refused.diagnostics).split("\n")[0]} | plain: compilerOk=${honest.compilerOk}`)
}

// --- API end to end on the demo chunk --------------------------------------
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
const dev = await call("POST", "/auth/sign-in", undefined, { email: "dev@re-hydra.local", password: "rehydra-dev" })
const token = dev.body.token
const demo = await one(`SELECT c.id FROM chunks c JOIN projects p ON p.id = c.project_id WHERE p.slug = 'demo' AND c.fuse_parent_id IS NULL LIMIT 1`)
const reset = async () => {
  await db.query(`DELETE FROM jobs WHERE chunk_id = $1`, [demo.id])
  await db.query(`UPDATE chunks SET current_match_id = NULL, best_attempt_id = NULL, allow_inline_asm = false WHERE id = $1`, [demo.id])
  await db.query(`DELETE FROM matches WHERE chunk_id = $1`, [demo.id])
  await db.query(`DELETE FROM attempts WHERE chunk_id = $1`, [demo.id])
  await db.query(`UPDATE chunks SET state = 'open', lease_user_id = NULL, lease_token = NULL, lease_expires_at = NULL, hold_started_at = NULL WHERE id = $1`, [demo.id])
}
const state = async () => (await one(`SELECT state FROM chunks WHERE id = $1`, [demo.id])).state
const settle = () => until("chunk to leave validating", async () => (await state()) !== "validating")
// The demo original is a single `ret` (0xc3).
const DEMO_FORGED = '__asm__(".text\\n.globl parse_header\\n.type parse_header,@function\\nparse_header:\\n.byte 0xc3\\n.size parse_header,.-parse_header\\n");\n'
await reset()
{
  const lease = (await call("POST", `/projects/demo/chunks/${demo.id}/checkout`, token)).body.leaseToken
  const first = await call("POST", `/projects/demo/chunks/${demo.id}/submit`, token, { leaseToken: lease, source: DEMO_FORGED })
  await settle()
  const a1 = await one(`SELECT matched, diagnostics FROM attempts WHERE id = $1`, [first.body.attemptId])
  check("API: a forged submit is a miss with the inline-assembly reason", a1.matched === false && /inline assembly is not allowed/.test(a1.diagnostics ?? ""),
    String(a1.diagnostics).split("\n")[0])

  const outsider = await call("POST", "/auth/sign-up", undefined, {
    email: `audit-asm-${randomBytes(3).toString("hex")}@example.test`, displayName: "Audit asm", password: randomBytes(18).toString("base64url")
  })
  const denied = await call("PUT", `/projects/demo/chunks/${demo.id}/inline-asm`, outsider.body.token, { allow: true })
  check("API: a non-member cannot allow inline assembly", denied.status === 403, `status ${denied.status}`)

  const devId = (await one(`SELECT id FROM users WHERE email = 'dev@re-hydra.local'`)).id
  const profile = async () => (await call("GET", `/users/${devId}`)).body
  const searchHit = async () => ((await call("GET", `/users?q=${encodeURIComponent("Dev User")}`)).body ?? []).find((h) => h.id === devId)
  const before = await profile()
  const beforeHit = await searchHit()

  const allowed = await call("PUT", `/projects/demo/chunks/${demo.id}/inline-asm`, token, { allow: true })
  check("API: the owner can allow inline assembly", ok(allowed.status) && allowed.body.allowInlineAsm === true, `status ${allowed.status}`)

  await call("POST", `/projects/demo/chunks/${demo.id}/submit`, token, { leaseToken: lease, source: DEMO_FORGED + "/* allowed */\n" })
  await settle()
  const summary = (await call("GET", `/projects/demo/chunks/${demo.id}`)).body
  const m = await one(`SELECT uses_inline_asm FROM matches WHERE chunk_id = $1 AND invalidated_at IS NULL`, [demo.id])
  check("API: with the opt-in it matches, and the match and board row are marked",
    summary.state === "matched" && summary.matchUsesInlineAsm === true && m?.uses_inline_asm === true,
    `state ${summary.state}, board mark ${summary.matchUsesInlineAsm}, match row ${m?.uses_inline_asm}`)

  // Audit A-041: the assembly match is shown but does not count toward reputation.
  const after = await profile()
  const afterHit = await searchHit()
  const asmEntry = (after.matchedChunks ?? []).find((m) => m.chunkId === demo.id && m.active)
  check("profile: reputation unchanged, assembly match counted separately and marked",
    after.reputation === before.reputation && after.survivingMatches === before.survivingMatches &&
      after.assemblyMatches === before.assemblyMatches + 1 && asmEntry?.usesInlineAsm === true,
    `reputation ${before.reputation}->${after.reputation}, assembly ${before.assemblyMatches}->${after.assemblyMatches}`)
  check("people search: same numbers as the profile",
    afterHit?.reputation === beforeHit?.reputation && afterHit?.assemblyMatches === (beforeHit?.assemblyMatches ?? 0) + 1,
    `reputation ${beforeHit?.reputation}->${afterHit?.reputation}, assembly ${beforeHit?.assemblyMatches}->${afterHit?.assemblyMatches}`)

  const off = await call("PUT", `/projects/demo/chunks/${demo.id}/inline-asm`, token, { allow: false })
  const active = await one(`SELECT COUNT(*)::int AS n FROM matches WHERE chunk_id = $1 AND invalidated_at IS NULL`, [demo.id])
  check("API: turning it off invalidates the assembly match and the chunk goes stale",
    ok(off.status) && off.body.state === "stale" && off.body.allowInlineAsm === false && active.n === 0,
    `state ${off.body.state}, active matches ${active.n}`)
  await db.query(`DELETE FROM users WHERE email LIKE 'audit-asm-%@example.test'`).catch(() => {})
}
await reset()
await db.end()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
