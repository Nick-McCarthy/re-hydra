// The export's symbol list (globals and thunks) is stored per binary, kept by a
// re-import that has no list, and replaced by one that does. Integration builds
// read it from binary_symbols.
//
//   AUDIT_API=http://localhost:3100/v1 \
//   AUDIT_DATABASE_URL=postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit \
//   node apps/api/scripts/verify-import-symbols.mjs
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const pg = require("pg")
const API = process.env.AUDIT_API ?? "http://localhost:3100/v1"
const DATABASE_URL = process.env.AUDIT_DATABASE_URL
if (!DATABASE_URL) throw new Error("Set AUDIT_DATABASE_URL to the throwaway database.")
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const fixture = JSON.parse(readFileSync(path.join(root, "fixtures/link/export.json"), "utf8"))
const db = new pg.Client({ connectionString: DATABASE_URL })
await db.connect()

const results = []
const check = (name, ok, detail = "") => {
  results.push(ok)
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
const ok = (s) => s >= 200 && s < 300
const detail = (r) => `${r.status}${r.body?.detail ? `: ${r.body.detail}` : ""}`

const signUp = await call("POST", "/auth/sign-up", undefined, {
  email: `audit-symbols-${randomBytes(3).toString("hex")}@example.test`,
  displayName: `Symbols ${randomBytes(2).toString("hex")}`,
  password: randomBytes(18).toString("base64url"), acceptPolicy: true
})
const token = signUp.body.token
const slug = `symbols-${randomBytes(3).toString("hex")}`
const P = `/projects/${slug}`
await call("POST", "/projects", token, {
  slug, name: "Import symbols", homeRegion: "us-east-1", language: fixture.language, toolchain: fixture.toolchain
})

const stored = async (binaryId) =>
  (await db.query(`SELECT name, address::text AS address, kind FROM binary_symbols WHERE binary_id = $1 ORDER BY name`, [binaryId])).rows

const first = await call("POST", `${P}/imports?rightsConfirmed=true`, token, {
  ...fixture,
  symbols: [
    { name: "counter", address: "0x402000", kind: "data" },
    { name: "DAT_00402010", address: "0x402010", kind: "data" },
    { name: "printf", address: "0x401200", kind: "function" },
    { name: "counter", address: "0x402000", kind: "data" }
  ]
})
check("an export with symbols imports", ok(first.status), detail(first))
const binaryId = first.body.binaryId
const afterFirst = await stored(binaryId)
check("each symbol is stored once with its address and kind",
  JSON.stringify(afterFirst) === JSON.stringify([
    { name: "DAT_00402010", address: String(0x402010), kind: "data" },
    { name: "counter", address: String(0x402000), kind: "data" },
    { name: "printf", address: String(0x401200), kind: "function" }
  ]), JSON.stringify(afterFirst))

const plain = await call("POST", `${P}/imports?rightsConfirmed=true`, token, fixture)
check("re-importing an export without a symbol list keeps the stored one",
  ok(plain.status) && (await stored(binaryId)).length === 3, detail(plain))

const replaced = await call("POST", `${P}/imports?rightsConfirmed=true`, token, { ...fixture, symbols: [{ name: "counter", address: "0x402004", kind: "data" }] })
const afterReplace = await stored(binaryId)
check("a new symbol list replaces the old one",
  ok(replaced.status) && afterReplace.length === 1 && afterReplace[0].address === String(0x402004), JSON.stringify(afterReplace))

const badName = await call("POST", `${P}/imports?rightsConfirmed=true`, token, { ...fixture, symbols: [{ name: "bad;name", address: "0x1", kind: "data" }] })
check("a symbol name outside the allowed characters is refused", badName.status === 400, detail(badName))
const badAddress = await call("POST", `${P}/imports?rightsConfirmed=true`, token, { ...fixture, symbols: [{ name: "x", address: "zz", kind: "data" }] })
check("a symbol address that is not a number is refused with the symbol's name",
  badAddress.status === 400 && /Symbol x/.test(badAddress.body?.detail ?? ""), detail(badAddress))

await db.end()
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
