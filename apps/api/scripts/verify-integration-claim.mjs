// An integration build that runs longer than the reclaim window is not run
// twice, and a worker that lost its claim writes nothing.
//
// This script runs a proxy in front of a real matchd that holds every link
// job for LINK_DELAY_MS. Start the API with MATCHD_URL pointing at the proxy
// and a short reclaim window:
//
//   MATCHD_URL=http://127.0.0.1:3290 INTEGRATION_RECLAIM_SECONDS=5 \
//   INTEGRATION_HEARTBEAT_SECONDS=1 RATE_LIMITS=off  (API on a throwaway DB)
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   REAL_MATCHD=http://127.0.0.1:3001 \
//   node apps/api/scripts/verify-integration-claim.mjs
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import http from "node:http"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const pg = require("pg")
const API = process.env.AUDIT_API ?? "http://localhost:3100/v1"
const DATABASE_URL = process.env.AUDIT_DATABASE_URL
const REAL_MATCHD = process.env.REAL_MATCHD ?? "http://127.0.0.1:3001"
const PROXY_PORT = Number(process.env.PROXY_PORT ?? 3290)
const LINK_DELAY_MS = Number(process.env.LINK_DELAY_MS ?? 12_000)
if (!DATABASE_URL) throw new Error("Set AUDIT_DATABASE_URL to the throwaway database.")
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const fixture = JSON.parse(readFileSync(path.join(root, "fixtures/link/export.json"), "utf8"))
const db = new pg.Client({ connectionString: DATABASE_URL })
await db.connect()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let linkRequests = 0
const onLink = []
const proxy = http.createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const isLink = req.url?.startsWith("/v1/link-jobs") === true
  if (isLink) {
    linkRequests++
    for (const f of onLink.splice(0)) f()
    await sleep(LINK_DELAY_MS)
  }
  const headers = { ...req.headers }
  delete headers.host
  delete headers["content-length"]
  const upstream = await fetch(`${REAL_MATCHD}${req.url}`, {
    method: req.method,
    headers,
    ...(chunks.length > 0 ? { body: Buffer.concat(chunks) } : {})
  })
  res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" })
  res.end(Buffer.from(await upstream.arrayBuffer()))
})
await new Promise((resolve) => proxy.listen(PROXY_PORT, "127.0.0.1", resolve))
const nextLink = () => new Promise((resolve) => onLink.push(resolve))

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
const signUp = async (label) => {
  const res = await call("POST", "/auth/sign-up", undefined, {
    email: `audit-claim-${label}-${randomBytes(3).toString("hex")}@example.test`,
    displayName: `Claim ${label} ${randomBytes(2).toString("hex")}`,
    password: randomBytes(18).toString("base64url"), acceptPolicy: true
  })
  if (res.status >= 300) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`)
  return { token: res.body.token }
}
const row = async (id) =>
  (await db.query("SELECT status, claimed_at, claim_token FROM integrations WHERE id = $1", [id])).rows[0]
const waitDone = async (id, seconds) => {
  for (let i = 0; i < seconds; i++) {
    const r = await row(id)
    if (r.status !== "queued" && r.status !== "running") return r
    await sleep(1000)
  }
  return row(id)
}

try {
  const owner = await signUp("owner")
  const slug = `claim-${randomBytes(3).toString("hex")}`
  const P = `/projects/${slug}`
  await call("POST", "/projects", owner.token, {
    slug, name: "Integration claim", homeRegion: "us-east-1", language: fixture.language, toolchain: fixture.toolchain
  })
  const imported = await call("POST", `${P}/imports?rightsConfirmed=true`, owner.token, fixture)
  if (imported.status >= 300) throw new Error(`import failed: ${imported.status}`)
  const board = (await call("GET", `${P}/chunks`)).body
  // An integration build needs at least two matched functions.
  for (const name of ["leaf", "caller"]) {
    const chunk = board.find((c) => c.name === name)
    const lease = await call("POST", `${P}/chunks/${chunk.id}/checkout`, owner.token)
    await call("POST", `${P}/chunks/${chunk.id}/submit`, owner.token, {
      leaseToken: lease.body.leaseToken, source: lease.body.bundle.pseudocode
    })
    for (let i = 0; i < 60; i++) {
      if ((await call("GET", `${P}/chunks/${chunk.id}`)).body.state === "matched") break
      await sleep(1000)
    }
    check(`setup: ${name} matches`, (await call("GET", `${P}/chunks/${chunk.id}`)).body.state === "matched")
  }

  // 1. A build that outlives the reclaim window keeps its claim.
  const before = linkRequests
  const linked = nextLink()
  const first = await call("POST", `${P}/integrations`, owner.token, { language: "c" })
  if (first.status >= 300) throw new Error(`integration start failed: ${first.status} ${JSON.stringify(first.body)}`)
  await linked
  const seen = new Set()
  const tokens = new Set()
  for (let i = 0; i < Math.floor(LINK_DELAY_MS / 1000) - 1; i++) {
    const r = await row(first.body.id)
    if (r.status === "running") {
      seen.add(new Date(r.claimed_at).getTime())
      tokens.add(r.claim_token)
    }
    await sleep(1000)
  }
  const done1 = await waitDone(first.body.id, 60)
  check("the claim is renewed while the build runs", seen.size >= 3, `${seen.size} distinct claimed_at values`)
  check("the claim token stays the same while it is renewed", tokens.size === 1)
  check("a build longer than the reclaim window runs once", linkRequests - before === 1, `${linkRequests - before} link requests`)
  check("and its result lands", done1.status === "passed", `status=${done1.status}`)

  // 2. A worker whose claim was taken writes nothing, and the build runs again.
  const before2 = linkRequests
  const linked2 = nextLink()
  const second = await call("POST", `${P}/integrations`, owner.token, { language: "c" })
  if (second.status >= 300) throw new Error(`integration start failed: ${second.status} ${JSON.stringify(second.body)}`)
  await linked2
  await db.query("UPDATE integrations SET claim_token = gen_random_uuid() WHERE id = $1", [second.body.id])
  // The first response comes back after LINK_DELAY_MS. It must not finish the build.
  await sleep(LINK_DELAY_MS + 1500)
  const midway = await row(second.body.id)
  const units = (await db.query("SELECT count(*)::int AS n FROM integration_units WHERE integration_id = $1 AND passed IS NOT NULL", [second.body.id])).rows[0].n
  check("a worker that lost its claim does not finish the build", midway.status === "running", `status=${midway.status}`)
  check("and writes no unit results", units === 0, `${units} units written`)
  const done2 = await waitDone(second.body.id, 60)
  check("the build is claimed again once the old claim goes stale and then passes",
    done2.status === "passed" && linkRequests - before2 === 2, `status=${done2.status}, ${linkRequests - before2} link requests`)
} finally {
  proxy.close()
  await db.end()
}

const passed = results.filter((r) => r.ok).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
