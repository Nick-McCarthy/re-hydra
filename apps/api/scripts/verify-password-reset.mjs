// End-to-end checks for password reset by emailed link.
//
// Needs an API with RATE_LIMITS=off and MAIL_DRIVER=file on a throwaway
// database, plus that database's URL and the API's MAIL_DIR:
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   AUDIT_MAIL_DIR=/path/the/api/writes/mail/to \
//   node apps/api/scripts/verify-password-reset.mjs
import { randomBytes } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const pg = require("pg")
const API = process.env.AUDIT_API ?? "http://localhost:3100/v1"
const DATABASE_URL = process.env.AUDIT_DATABASE_URL
const MAIL_DIR = process.env.AUDIT_MAIL_DIR
if (!DATABASE_URL || !MAIL_DIR) throw new Error("Set AUDIT_DATABASE_URL and AUDIT_MAIL_DIR.")
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
const detail = (r) => `${r.status}${r.body?.detail ? `: ${r.body.detail}` : ""}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const mailsTo = (email) => {
  let names = []
  try { names = readdirSync(MAIL_DIR) } catch { return [] }
  return names
    .filter((n) => n.endsWith(".json"))
    .map((n) => JSON.parse(readFileSync(path.join(MAIL_DIR, n), "utf8")))
    .filter((m) => m.to === email)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))
}
/** Mailing runs detached from the request, so wait for the file. */
const waitForMail = async (email, count) => {
  for (let i = 0; i < 40; i++) {
    const mails = mailsTo(email)
    if (mails.length >= count) return mails
    await sleep(100)
  }
  return mailsTo(email)
}
const tokenOf = (mail) => /#token=([A-Za-z0-9_-]+)/.exec(mail?.text ?? "")?.[1] ?? null

const email = `audit-reset-${randomBytes(3).toString("hex")}@example.test`
const oldPassword = randomBytes(18).toString("base64url")
const newPassword = randomBytes(18).toString("base64url")
const up = await call("POST", "/auth/sign-up", undefined, { email, displayName: "Reset tester", password: oldPassword })
const oldSession = up.body.token

// --- Asking.
const unknown = `audit-nobody-${randomBytes(3).toString("hex")}@example.test`
const r0 = await call("POST", "/auth/password-reset", undefined, { email: unknown })
await sleep(500)
check("an unknown email gets the same answer and no mail", r0.status === 204 && mailsTo(unknown).length === 0, detail(r0))
const bad = await call("POST", "/auth/password-reset", undefined, { email: "not-an-email" })
check("a malformed email is refused", bad.status === 400, detail(bad))
const r1 = await call("POST", "/auth/password-reset", undefined, { email: email.toUpperCase() })
const first = await waitForMail(email, 1)
const token1 = tokenOf(first[0])
check("a known email (any case) gets a link with a token in the fragment",
  r1.status === 204 && first.length === 1 && token1 !== null && first[0].text.includes("http://localhost:5174/reset-password#token="),
  detail(r1))
const stored = (await db.query(
  `SELECT encode(token_hash, 'hex') AS h FROM password_resets r JOIN users u ON u.id = r.user_id WHERE u.email = $1`, [email]
)).rows
check("only a hash of the token is stored", stored.length === 1 && !stored[0].h.includes(token1 ?? "x"))

// --- A second request retires the first link.
await call("POST", "/auth/password-reset", undefined, { email })
const second = await waitForMail(email, 2)
const token2 = tokenOf(second[1])
const oldLink = await call("POST", "/auth/password-reset/confirm", undefined, { token: token1, newPassword })
check("asking again retires the earlier link", oldLink.status === 400 && token2 !== null && token2 !== token1, detail(oldLink))

// --- Confirming.
const garbage = await call("POST", "/auth/password-reset/confirm", undefined, { token: randomBytes(32).toString("base64url"), newPassword })
check("an unknown token is refused", garbage.status === 400 && /invalid/.test(garbage.body?.detail ?? ""), detail(garbage))
const short = await call("POST", "/auth/password-reset/confirm", undefined, { token: token2, newPassword: "short" })
check("the new password must be 8 or more characters", short.status === 400, detail(short))
const confirmed = await call("POST", "/auth/password-reset/confirm", undefined, { token: token2, newPassword })
check("a good token sets the password", confirmed.status === 204, detail(confirmed))
const me = await call("GET", "/auth/me", oldSession)
check("every existing session ends", me.status === 401, detail(me))
const withOld = await call("POST", "/auth/sign-in", undefined, { email, password: oldPassword })
const withNew = await call("POST", "/auth/sign-in", undefined, { email, password: newPassword })
check("the old password stops working and the new one works", withOld.status === 401 && withNew.status === 201, `${withOld.status}/${withNew.status}`)
const reused = await call("POST", "/auth/password-reset/confirm", undefined, { token: token2, newPassword: oldPassword })
check("a link works only once", reused.status === 400, detail(reused))

// --- Expiry.
await call("POST", "/auth/password-reset", undefined, { email })
const third = await waitForMail(email, 3)
await db.query(
  `UPDATE password_resets SET expires_at = now() - interval '1 minute'
   WHERE used_at IS NULL AND user_id = (SELECT id FROM users WHERE email = $1)`, [email]
)
const expired = await call("POST", "/auth/password-reset/confirm", undefined, { token: tokenOf(third[2]), newPassword: oldPassword })
check("a link older than an hour is refused", expired.status === 400, detail(expired))

// --- An account that never had a password (made before passwords existed).
const legacy = `audit-legacy-${randomBytes(3).toString("hex")}@example.test`
await db.query(`INSERT INTO users (email, display_name) VALUES ($1, 'Legacy user')`, [legacy])
await call("POST", "/auth/password-reset", undefined, { email: legacy })
const legacyMail = await waitForMail(legacy, 1)
const legacySet = await call("POST", "/auth/password-reset/confirm", undefined, { token: tokenOf(legacyMail[0]), newPassword })
const legacyIn = await call("POST", "/auth/sign-in", undefined, { email: legacy, password: newPassword })
check("an account with no password can set one by reset", legacySet.status === 204 && legacyIn.status === 201, `${legacySet.status}/${legacyIn.status}`)

await db.end()
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
