// Integration build: a matched function that calls one nobody has matched yet.
//
//   MATCHD=http://127.0.0.1:3001 MATCHD_TOKEN=dev-matchd-token node apps/matchd/scripts/verify-link-symbols.mjs
//
// Links `caller` from fixtures/link on its own. Its call to `leaf` must land on
// leaf's original address when the job names it, be blanked when it does not,
// and fail when the job names the wrong address.
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const MATCHD = process.env.MATCHD ?? "http://127.0.0.1:3001"
const TOKEN = process.env.MATCHD_TOKEN ?? "dev-matchd-token"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const fixture = JSON.parse(readFileSync(path.join(root, "fixtures/link/export.json"), "utf8"))
const fn = (name) => fixture.functions.find((f) => f.name === name)

const results = []
const check = (name, ok, detail = "") => {
  results.push(ok)
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
}

const link = async (names, symbols) => {
  const res = await fetch(`${MATCHD}/v1/link-jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      jobId: crypto.randomUUID(),
      arch: fixture.arch,
      language: "c",
      toolchain: fixture.toolchain,
      headers: fixture.types,
      units: names.map((name) => ({
        symbol: name,
        address: fn(name).address,
        size: fn(name).size,
        originalBytesBase64: fn(name).bytesBase64,
        source: readFileSync(path.join(root, `fixtures/link/${name}.c`), "utf8")
      })),
      ...(symbols ? { symbols } : {})
    })
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`)
  return body.units.find((unit) => unit.symbol === names[0])
}

const named = await link(["caller"], [{ name: "leaf", address: fn("leaf").address }])
check("caller passes when the unmatched leaf is placed at its original address",
  named?.passed === true && !named.detail.includes("not compared"), named?.detail)

const unnamed = await link(["caller"])
check("without leaf's address the call is blanked, not counted as a mismatch",
  unnamed?.passed === true && unnamed.detail.includes("not compared (leaf)"), unnamed?.detail)

const wrong = await link(["caller"], [{ name: "leaf", address: "0x401010" }])
check("with leaf at the wrong address the call disagrees",
  wrong?.passed === false && wrong.detail.startsWith("mismatch at 0x401045"), wrong?.detail.split("\n")[0])

const both = await link(["leaf", "caller"], [{ name: "decoy", address: fn("decoy").address }])
check("linking leaf and caller together still passes", both?.passed === true, both?.detail)

const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
