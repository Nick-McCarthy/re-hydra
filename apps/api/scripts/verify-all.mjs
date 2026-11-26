// Runs the verify-*.mjs scripts against a fresh database and an API this
// script starts, then tears both down (foundations plan 7d).
//
//   npm run verify                        every script that can run here
//   npm run verify -- --only scopes,join  scripts whose name contains a filter
//   npm run verify -- --list              what would run, and why some would not
//   npm run verify -- --keep              keep the database afterwards
//   npm run verify -- --require-matchd    fail, not skip, when matchd is down
//
// Needs Postgres (docker compose up -d postgres). Scripts that compile need
// matchd (docker compose up -d matchd); without it they are skipped.
//
// VERIFY_ADMIN_DATABASE_URL  a connection that may create databases
//                            (default postgres://rehydra:rehydra@127.0.0.1:5432/postgres)
// VERIFY_MATCHD_URL          default http://127.0.0.1:3001
// VERIFY_MATCHD_TOKEN        default dev-matchd-token
//
// The API is started without apps/api/.env, with only the settings below, so
// a developer's local configuration (S3 blobs, Docker autoscaling, real mail)
// never reaches a test run.
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import pg from "pg"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const only = option("--only")?.split(",").map((s) => s.trim()).filter(Boolean)
const ADMIN_URL = process.env.VERIFY_ADMIN_DATABASE_URL ?? "postgres://rehydra:rehydra@127.0.0.1:5432/postgres"
const MATCHD_URL = process.env.VERIFY_MATCHD_URL ?? "http://127.0.0.1:3001"
const MATCHD_TOKEN = process.env.VERIFY_MATCHD_TOKEN ?? "dev-matchd-token"
const NOTIFY_SECONDS = 3
const APP_URL = "http://localhost:5173"
const SCRIPT_TIMEOUT_MS = 10 * 60_000

/**
 * Every verify script, in run order. `api` is extra API configuration (the
 * API restarts when it differs from the previous script's); `matchd` means
 * the script compiles; `manual` says why a script cannot run here. `tests`
 * are node:test files run against the database with no API (each test rolls
 * back, so later scripts see the seeded database unchanged).
 */
const scripts = [
  {
    name: "chunk-state-tests",
    tests: ["src/services/chunkState.leases.db.test.ts", "src/services/chunkState.matches.db.test.ts"]
  },
  { name: "verify-token-scopes" },
  { name: "verify-access" },
  { name: "verify-agent-input" },
  { name: "verify-discussion" },
  { name: "verify-join" },
  { name: "verify-members" },
  { name: "verify-moderation" },
  { name: "verify-import-symbols" },
  { name: "verify-hardening" },
  { name: "verify-password-reset" },
  { name: "verify-report-emails" },
  { name: "verify-audit-fixes", matchd: true },
  { name: "verify-call-targets", matchd: true },
  { name: "verify-checkout-loop", matchd: true },
  { name: "verify-profile", matchd: true },
  { name: "verify-inline-asm", matchd: true },
  { name: "verify-account-deletion", matchd: true },
  // Writes the link fixture's hash into the malware list, so it runs after
  // everything else that imports that fixture under the plain configuration.
  { name: "verify-malware-hashes", api: ({ listFile }) => ({ MALWARE_HASHLIST_URL: pathToFileURL(listFile).href }) },
  {
    name: "verify-limits",
    matchd: true,
    api: () => ({ RATE_LIMITS: "on", TRUSTED_PROXIES: "127.0.0.1/32,::1/128" })
  },
  {
    name: "verify-integration-claim",
    matchd: true,
    api: ({ proxyPort }) => ({
      MATCHD_URL: `http://127.0.0.1:${proxyPort}`,
      INTEGRATION_RECLAIM_SECONDS: "5",
      INTEGRATION_HEARTBEAT_SECONDS: "1"
    })
  },
  { name: "verify-flags", manual: "starts a container per compiler image; run it by hand with the images built" },
  { name: "verify-phase3", manual: "needs the 100,000-chunk scale100k project from the audit's phase 3 notes" },
  { name: "verify-small-fixes", manual: "needs scale100k, and stops and restarts the compose matchd container" }
]

// Every setting the API reads. The test API gets these only from `apiEnv`.
const API_SETTINGS = [
  "API_HSTS", "API_MAX_BODY_MB", "API_MAX_IMPORT_MB", "API_PORT", "APP_URL", "BLOB_S3_ACCESS_KEY", "BLOB_S3_BUCKET",
  "BLOB_S3_ENDPOINT", "BLOB_S3_REGION", "BLOB_S3_SECRET_KEY", "BLOB_STORE", "DATABASE_URL",
  "INTEGRATION_HEARTBEAT_SECONDS", "INTEGRATION_RECLAIM_SECONDS", "MAIL_DIR", "MAIL_DRIVER", "MAIL_FROM",
  "MALWARE_HASHLIST_AUTH_KEY", "MALWARE_HASHLIST_REFRESH_HOURS", "MALWARE_HASHLIST_URL", "MALWARE_NOTIFY_SECONDS",
  "MATCHD_ROUTES", "MATCHD_SCALE", "MATCHD_SCALE_MAX", "MATCHD_SECCOMP_PROFILE", "MATCHD_TOKEN", "MATCHD_URL",
  "MATCHD_WORKERS", "PUBLIC_API_URL", "RATE_LIMITS", "REPORT_NOTIFY_SECONDS", "SES_ACCESS_KEY", "SES_REGION",
  "SES_SECRET_KEY", "TRUSTED_PROXIES"
]
const cleanEnv = () => {
  const env = { ...process.env }
  for (const key of API_SETTINGS) delete env[key]
  return env
}

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const reachable = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
    return res.ok
  } catch {
    return false
  }
}

/** Runs node with tsx on a TypeScript entry point; resolves with the exit code. */
const runNode = (argv, { env, log, timeoutMs, cwd = root }) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, argv, { cwd, env, stdio: ["ignore", "pipe", "pipe"] })
    child.stdout.pipe(log, { end: false })
    child.stderr.pipe(log, { end: false })
    const timer = timeoutMs ? setTimeout(() => child.kill(), timeoutMs) : undefined
    child.on("exit", (code, signal) => {
      clearTimeout(timer)
      resolve(code ?? (signal ? 1 : 0))
    })
  })
const tsx = (file) => ["--import", "tsx", path.join(root, file)]

const selected = scripts.filter((s) => !only || only.some((f) => s.name.includes(f)))
if (selected.length === 0) {
  console.error(`No verify script matches ${only.join(", ")}.`)
  process.exit(2)
}

const matchdUp = await reachable(`${MATCHD_URL}/v1/health`)
if (!matchdUp && flag("--require-matchd")) {
  console.error(`matchd is not answering at ${MATCHD_URL}/v1/health. Start it with: docker compose up -d matchd`)
  process.exit(2)
}
const plan = selected.map((s) => ({
  ...s,
  skip: s.manual ?? (s.matchd && !matchdUp ? `matchd is not answering at ${MATCHD_URL}` : undefined)
}))
if (flag("--list")) {
  for (const s of plan) console.log(`${s.skip ? "skip" : "run "}  ${s.name}${s.skip ? `  (${s.skip})` : ""}`)
  process.exit(0)
}
const toRun = plan.filter((s) => !s.skip)

// --- Database
const dbName = `rehydra_test_${randomBytes(4).toString("hex")}`
const adminUrl = new URL(ADMIN_URL)
const databaseUrl = Object.assign(new URL(ADMIN_URL), { pathname: `/${dbName}` }).href
const admin = new pg.Client({ connectionString: ADMIN_URL })
try {
  await admin.connect()
} catch (error) {
  console.error(`Cannot reach Postgres at ${adminUrl.host} (${error.message}). Start it with: docker compose up -d postgres`)
  process.exit(2)
}
await admin.query(`CREATE DATABASE "${dbName}"`)

const work = mkdtempSync(path.join(os.tmpdir(), "rehydra-verify-"))
const mailDir = path.join(work, "mail")
mkdirSync(mailDir)
const listFile = path.join(work, "malware-list.txt")
writeFileSync(listFile, "")
const logPath = (name) => path.join(work, `${name}.log`)
const openLog = (name) => createWriteStream(logPath(name))
const tail = (file, lines = 40) => readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n")

let api
const stopApi = async () => {
  if (!api) return
  const child = api.child
  api = undefined
  if (child.exitCode === null) {
    const exited = new Promise((r) => child.once("exit", r))
    child.kill()
    await Promise.race([exited, sleep(5000)])
  }
}
const cleanup = async () => {
  await stopApi()
  if (!flag("--keep")) {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`).catch(() => {})
  }
  await admin.end().catch(() => {})
}
process.on("SIGINT", async () => {
  await cleanup()
  process.exit(130)
})

const results = []
let exitCode = 0
try {
  const setupEnv = { ...cleanEnv(), DATABASE_URL: databaseUrl, BLOB_STORE: "postgres" }
  for (const step of ["migrate", "seed"]) {
    const log = openLog(step)
    const code = await runNode(tsx(`apps/api/src/db/${step}.ts`), { env: setupEnv, log, timeoutMs: 5 * 60_000 })
    log.end()
    if (code !== 0) throw new Error(`${step} failed (exit ${code}):\n${tail(logPath(step))}`)
  }
  console.log(`Database ${dbName} migrated and seeded. Logs in ${work}\n`)

  const startApi = async (extra) => {
    const port = await freePort()
    const env = {
      ...cleanEnv(),
      DATABASE_URL: databaseUrl,
      API_PORT: String(port),
      PUBLIC_API_URL: `http://127.0.0.1:${port}`,
      APP_URL,
      BLOB_STORE: "postgres",
      MATCHD_URL,
      MATCHD_TOKEN,
      MATCHD_SCALE: "off",
      RATE_LIMITS: "off",
      API_HSTS: "off",
      MAIL_DRIVER: "file",
      MAIL_DIR: mailDir,
      REPORT_NOTIFY_SECONDS: String(NOTIFY_SECONDS),
      MALWARE_NOTIFY_SECONDS: String(NOTIFY_SECONDS),
      ...extra
    }
    const log = openLog(`api-${port}`)
    const child = spawn(process.execPath, tsx("apps/api/src/main.ts"), { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] })
    child.stdout.pipe(log)
    child.stderr.pipe(log)
    api = { child, port, key: JSON.stringify(extra), log: logPath(`api-${port}`) }
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`the API exited while starting:\n${tail(api.log)}`)
      if (await reachable(`http://127.0.0.1:${port}/v1/health`)) return
      await sleep(250)
    }
    throw new Error(`the API did not answer /v1/health within 90 seconds:\n${tail(api.log)}`)
  }

  for (const s of toRun) {
    if (s.tests) {
      const started = Date.now()
      const log = openLog(s.name)
      const code = await runNode(["--import", "tsx", "--test", ...s.tests], {
        cwd: path.join(root, "apps/api"),
        env: { ...cleanEnv(), TEST_DATABASE_URL: databaseUrl },
        log,
        timeoutMs: SCRIPT_TIMEOUT_MS
      })
      await new Promise((r) => log.end(r))
      const text = readFileSync(logPath(s.name), "utf8")
      const count = (label) => text.match(new RegExp(`^ℹ ${label} (\\d+)`, "m"))?.[1]
      const summary = count("tests") ? `${count("pass")}/${count("tests")} checks passed` : ""
      const ok = code === 0
      results.push({ name: s.name, ok })
      console.log(`${ok ? "PASS" : "FAIL"}  ${s.name.padEnd(28)} ${summary.padEnd(22)} ${((Date.now() - started) / 1000).toFixed(0)}s`)
      if (!ok) {
        // node:test lists each failure twice: where it ran, and in its summary.
        const failures = [...new Set(text.split("\n").filter((l) => /^✖ (?!failing tests)/.test(l)))]
        console.log((failures.length > 0 ? failures.join("\n") : tail(logPath(s.name), 25)).replace(/^/gm, "      "))
      }
      continue
    }
    const proxyPort = await freePort()
    const extra = s.api ? s.api({ listFile, proxyPort }) : {}
    if (!api || api.key !== JSON.stringify(extra)) {
      await stopApi()
      await startApi(extra)
    }
    const env = {
      ...process.env,
      AUDIT_API: `http://127.0.0.1:${api.port}/v1`,
      AUDIT_DATABASE_URL: databaseUrl,
      AUDIT_MAIL_DIR: mailDir,
      AUDIT_APP_URL: APP_URL,
      AUDIT_LIST_FILE: listFile,
      AUDIT_NOTIFY_SECONDS: String(NOTIFY_SECONDS),
      AUDIT_MATCHD: MATCHD_URL,
      AUDIT_MATCHD_TOKEN: MATCHD_TOKEN,
      REAL_MATCHD: MATCHD_URL,
      PROXY_PORT: String(proxyPort)
    }
    const started = Date.now()
    const log = openLog(s.name)
    const code = await runNode([path.join(root, "apps/api/scripts", `${s.name}.mjs`)], {
      env,
      log,
      timeoutMs: SCRIPT_TIMEOUT_MS
    })
    await new Promise((r) => log.end(r))
    const seconds = ((Date.now() - started) / 1000).toFixed(0)
    const text = readFileSync(logPath(s.name), "utf8")
    const summary = text.match(/(\d+)\/(\d+) checks passed/)?.[0] ?? ""
    const ok = code === 0
    results.push({ name: s.name, ok })
    console.log(`${ok ? "PASS" : "FAIL"}  ${s.name.padEnd(28)} ${summary.padEnd(22)} ${seconds}s`)
    if (!ok) {
      const failures = text.split("\n").filter((l) => l.startsWith("FAIL"))
      console.log((failures.length > 0 ? failures.join("\n") : tail(logPath(s.name), 25)).replace(/^/gm, "      "))
    }
    if (api.child.exitCode !== null) {
      console.log(`      the API exited during ${s.name}:\n${tail(api.log, 20).replace(/^/gm, "      ")}`)
      api = undefined
    }
  }
} catch (error) {
  console.error(`\n${error.message}`)
  exitCode = 2
} finally {
  await cleanup()
}

for (const s of plan.filter((p) => p.skip)) console.log(`skip  ${s.name.padEnd(28)} ${s.skip}`)
const failed = results.filter((r) => !r.ok)
console.log(
  `\n${results.length - failed.length}/${results.length} scripts passed` +
    (plan.some((p) => p.skip) ? `, ${plan.filter((p) => p.skip).length} skipped` : "") +
    (flag("--keep") ? `. Database kept: ${databaseUrl}` : "")
)
if (failed.length === 0 && exitCode === 0 && !flag("--keep")) rmSync(work, { recursive: true, force: true })
else console.log(`Logs: ${work}`)
process.exit(exitCode || (failed.length > 0 ? 1 : 0))
