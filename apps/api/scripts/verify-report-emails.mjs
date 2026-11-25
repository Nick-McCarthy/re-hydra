// Site admins are emailed about new reports, grouped per tick.
//
// Needs the API on a throwaway database with RATE_LIMITS=off,
// MAIL_DRIVER=file, and a short REPORT_NOTIFY_SECONDS (2 or 3):
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   AUDIT_MAIL_DIR=/path/the/api/writes/mail/to \
//   AUDIT_NOTIFY_SECONDS=3 \
//   node apps/api/scripts/verify-report-emails.mjs
import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const pg = require("pg")
const API = process.env.AUDIT_API ?? "http://localhost:3100/v1"
const DATABASE_URL = process.env.AUDIT_DATABASE_URL
const MAIL_DIR = process.env.AUDIT_MAIL_DIR
const TICK_MS = Number(process.env.AUDIT_NOTIFY_SECONDS ?? 3) * 1000
if (!DATABASE_URL || !MAIL_DIR) throw new Error("Set AUDIT_DATABASE_URL and AUDIT_MAIL_DIR.")
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
  const send = () => fetch(`${API}${p}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  // The admin command runs between requests for longer than the server keeps
  // an idle connection, so the first request after it can hit a closed socket.
  const res = await send().catch((error) => {
    if (error?.cause?.code === "ECONNRESET") return send()
    throw error
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, body: json }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tag = () => randomBytes(3).toString("hex")
const signUp = async (label) => {
  const account = {
    email: `audit-notify-${label}-${tag()}@example.test`,
    displayName: `Notify ${label} ${tag()}`,
    password: randomBytes(18).toString("base64url")
  }
  const res = await call("POST", "/auth/sign-up", undefined, { ...account, acceptPolicy: true })
  if (res.status !== 201) throw new Error(`sign-up failed: ${res.status}`)
  return { ...account, token: res.body.token, id: res.body.user.id }
}
const adminCommand = (...args) =>
  execFileSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), path.join(root, "apps/api/src/db/admin.ts"), ...args], {
    cwd: path.join(root, "apps/api"), env: { ...process.env, DATABASE_URL }, stdio: "ignore"
  })
const mailTo = (email) =>
  readdirSync(MAIL_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(path.join(MAIL_DIR, name), "utf8")))
    .filter((mail) => mail.to === email)
const waitForMail = async (email, atLeast) => {
  const deadline = Date.now() + TICK_MS * 4 + 5000
  while (Date.now() < deadline) {
    const mail = mailTo(email)
    if (mail.length >= atLeast) return mail
    await sleep(250)
  }
  return mailTo(email)
}

const admin = await signUp("admin")
adminCommand("grant", admin.email)
const formerAdmin = await signUp("former")
adminCommand("grant", formerAdmin.email)
adminCommand("revoke", formerAdmin.email)
const owner = await signUp("owner")
const reporter = await signUp("reporter")

const slug = `notify-${tag()}`
const P = `/projects/${slug}`
await call("POST", "/projects", owner.token, {
  slug, name: `Notify ${slug}`, homeRegion: "us-east-1", language: fixture.language, toolchain: fixture.toolchain
})
await call("POST", `${P}/imports?rightsConfirmed=true`, owner.token, fixture)
const leaf = (await call("GET", `${P}/chunks`)).body.find((c) => c.name === "leaf")
const thread = await call("POST", `${P}/threads`, owner.token, { title: "Hi", body: "a post to report" })

// Three reports in quick succession: they should arrive grouped.
const reports = await Promise.all([
  call("POST", "/reports", reporter.token, { projectSlug: slug, reason: "copyright", body: "First report." }),
  call("POST", "/reports", reporter.token, { projectSlug: slug, chunkId: leaf.id, reason: "malware", body: "Second report." }),
  call("POST", "/reports", reporter.token, { projectSlug: slug, postId: thread.body.posts[0].id, reason: "abuse", body: "Third report." })
])
check("three reports are filed", reports.every((r) => r.status === 201), reports.map((r) => r.status).join(","))

const mail = await waitForMail(admin.email, 1)
await sleep(TICK_MS + 500) // let a straggler land if a tick split the burst
const all = mailTo(admin.email)
const text = all.map((m) => m.text).join("\n")
check("the admin is emailed about every report, with the function and the post",
  ["First report.", "Second report.", "Third report."].every((s) => text.includes(s)) &&
    text.includes("function leaf") && text.includes("a post to report") && text.includes("/admin"),
  `${all.length} email(s)`)
check("a burst of reports is grouped (at most two emails for three reports)",
  mail.length >= 1 && all.length <= 2 && all.some((m) => /new reports/.test(m.subject)),
  all.map((m) => m.subject).join(" | "))

const ids = reports.map((r) => r.body.id)
const rows = (await db.query("SELECT notified_at FROM reports WHERE id = ANY($1::uuid[])", [ids])).rows
check("the reports are marked notified", rows.length === 3 && rows.every((r) => r.notified_at !== null))

await sleep(TICK_MS * 2 + 500)
check("a notified report is not emailed again", mailTo(admin.email).length === all.length, `${mailTo(admin.email).length}`)
check("someone whose admin was revoked gets nothing", mailTo(formerAdmin.email).length === 0)
check("the reporter and the owner get nothing", mailTo(reporter.email).length === 0 && mailTo(owner.email).length === 0)

await db.end()
const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
