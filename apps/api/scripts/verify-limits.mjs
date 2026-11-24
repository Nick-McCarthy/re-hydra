// End-to-end checks for audit A-034 (body size) and A-035 (rate limits).
//
// Start the API with rate limits on and the local loopback trusted as a proxy,
// so the script can stand in for different clients with X-Forwarded-For:
//
//   RATE_LIMITS=on TRUSTED_PROXIES=127.0.0.1/32,::1/128 API_PORT=3100 \
//   DATABASE_URL=postgres://…/rehydra_audit npm run start -w @re-hydra/api
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   AUDIT_MATCHD=http://127.0.0.1:3001 AUDIT_MATCHD_TOKEN=dev-matchd-token \
//   node apps/api/scripts/verify-limits.mjs
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

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
}

// A fresh made-up client address for each check, from a documentation range.
let clientSeq = Math.floor(Math.random() * 200)
const newClient = () => `198.51.100.${(clientSeq++ % 250) + 1}`

const post = async (url, body, { client, token, raw } = {}) => {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(client ? { "x-forwarded-for": client } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: raw ?? JSON.stringify(body)
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, retryAfter: res.headers.get("retry-after"), body: json }
}
const bigJson = (megabytes) => `{"email":"a@b.test","displayName":"x","password":"${"A".repeat(megabytes * 1024 * 1024)}"}`

// --- A-034: body size ------------------------------------------------------
{
  const t0 = performance.now()
  const huge = await post(`${API}/auth/sign-up`, null, { client: newClient(), raw: bigJson(60) })
  check("API: a 60 MB unauthenticated body is refused with 413", huge.status === 413, `status ${huge.status}, ${Math.round(performance.now() - t0)} ms`)
  const five = await post(`${API}/auth/sign-in`, null, { client: newClient(), raw: bigJson(5) })
  check("API: 5 MB on an ordinary route is over the 4 MB default", five.status === 413, `status ${five.status}`)
  const small = await post(`${API}/auth/sign-in`, { email: "nobody@example.test", password: "x" }, { client: newClient() })
  check("API: a normal small body still works", small.status === 401, `status ${small.status}`)
}

const signIn = await post(`${API}/auth/sign-in`, { email: "dev@re-hydra.local", password: "rehydra-dev" }, { client: newClient() })
const devToken = signIn.body.token
{
  const sixOnImport = await post(`${API}/projects/demo/imports`, null, { client: newClient(), token: devToken, raw: `{"junk":"${"A".repeat(6 * 1024 * 1024)}"}` })
  check("API: the import route accepts more than 4 MB (rejected by schema, not size)", sixOnImport.status === 400, `status ${sixOnImport.status}`)
  const seventy = await post(`${API}/projects/demo/imports`, null, { client: newClient(), token: devToken, raw: `{"junk":"${"A".repeat(70 * 1024 * 1024)}"}` })
  check("API: the import route still stops at 64 MB", seventy.status === 413, `status ${seventy.status}`)
}
{
  const res = await fetch(`${MATCHD}/v1/jobs`, {
    method: "POST",
    headers: { authorization: `Bearer ${MATCHD_TOKEN}`, "content-type": "application/json" },
    body: `{"jobId":"big","pad":"${"A".repeat(70 * 1024 * 1024)}"}`
  })
  check("matchd: a 70 MB job body is refused with 413", res.status === 413, `status ${res.status}`)
}

// --- A-035: rate limits ----------------------------------------------------
{
  const client = newClient()
  const codes = []
  let last
  for (let i = 0; i < 11; i++) {
    last = await post(`${API}/auth/sign-in`, { email: `nobody-${i}@example.test`, password: "wrong-password" }, { client })
    codes.push(last.status)
  }
  check("sign-in: the 11th attempt in a minute from one address gets 429 with Retry-After",
    codes.slice(0, 10).every((c) => c === 401) && last.status === 429 && Number(last.retryAfter) > 0,
    `${codes.join(",")}, retry-after ${last.retryAfter}`)
}
{
  const email = `target-${randomBytes(3).toString("hex")}@example.test`
  const codes = []
  let last
  for (let i = 0; i < 11; i++) {
    last = await post(`${API}/auth/sign-in`, { email, password: "wrong-password" }, { client: newClient() })
    codes.push(last.status)
  }
  check("sign-in: one account is limited even when every attempt comes from a new address",
    codes.slice(0, 10).every((c) => c === 401) && last.status === 429 && /Too many sign-in attempts/.test(JSON.stringify(last.body)),
    codes.join(","))
}
{
  const client = newClient()
  const codes = []
  for (let i = 0; i < 6; i++) {
    const res = await post(`${API}/auth/sign-up`, {
      email: `audit-limit-${randomBytes(4).toString("hex")}@example.test`,
      displayName: "Audit limit",
      password: randomBytes(18).toString("base64url")
    }, { client })
    codes.push(res.status)
  }
  check("sign-up: the 6th account in an hour from one address gets 429",
    codes.slice(0, 5).every((c) => c === 201) && codes[5] === 429, codes.join(","))
}

const db = new pg.Client({ connectionString: DATABASE_URL })
await db.connect()
await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'audit-limit-%@example.test')`)
await db.query(`DELETE FROM users WHERE email LIKE 'audit-limit-%@example.test'`)
await db.end()

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
