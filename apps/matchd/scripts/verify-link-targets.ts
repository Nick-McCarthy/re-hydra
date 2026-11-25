// Integration builds on each console image.
//
//   node --import tsx apps/matchd/scripts/verify-link-targets.ts [target-id ...]
//
// For each target this starts a throwaway matchd container from the image
// tagged rehydra-linktest-<name>, builds a small reference program inside it
// (leaf, caller, and a global, fully linked at fixed addresses), and then asks
// matchd to link `caller` alone, with leaf and the global given only as known
// addresses. The call and the data access must both land where the reference
// put them. A wrong address for the global must fail.
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readElfSections } from "../src/elf.js"
import { SCRATCH_INPUTS, findObjectSymbol } from "../src/linkSymbols.js"
import { matchTargets } from "../src/targets/registry.js"
import type { MatchTarget } from "../src/targets/types.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const seccomp = path.join(root, "docker-yml/matchd-seccomp.json")
const TOKEN = "dev-matchd-token"

type Case = { readonly tag: string; readonly target: string; readonly flags: ReadonlyArray<string>; readonly arch: string }

const cases: ReadonlyArray<Case> = [
  { tag: "host", target: "host-gcc", flags: ["-O2"], arch: "x86_64" },
  { tag: "n64", target: "n64-gcc", flags: ["-O2", "-mno-abicalls", "-G0"], arch: "MIPS" },
  { tag: "ps1", target: "ps1-gcc", flags: ["-O2", "-mno-abicalls", "-fno-pic", "-G0"], arch: "MIPS" },
  { tag: "ps2", target: "ps2-gcc", flags: ["-O2", "-mno-abicalls", "-fno-pic", "-G0"], arch: "MIPS" },
  { tag: "psp", target: "psp-gcc", flags: ["-O2", "-G0"], arch: "Allegrex" },
  { tag: "ps3", target: "ps3-gcc", flags: ["-O2"], arch: "PowerPC64" },
  { tag: "wiiu", target: "wiiu-gcc", flags: ["-O2", "-fno-pic"], arch: "PowerPC" },
  { tag: "mwcc", target: "gamecube-mwcc", flags: ["-O4"], arch: "PowerPC" },
  { tag: "gba", target: "gba-agbcc", flags: ["-O2"], arch: "ARM" },
  { tag: "ds", target: "ds-gcc", flags: ["-O2"], arch: "ARM" },
  { tag: "3ds", target: "3ds-gcc", flags: ["-O2"], arch: "ARM" },
  { tag: "ds", target: "ds-gcc", flags: ["-O2", "-mthumb"], arch: "ARM" },
  { tag: "3ds", target: "3ds-gcc", flags: ["-O2", "-mthumb"], arch: "ARM" },
  { tag: "switch", target: "switch-clang", flags: ["-O2"], arch: "AARCH64" },
  { tag: "ps4", target: "ps4-clang", flags: ["-O2"], arch: "x86_64" },
  { tag: "dc", target: "dc-gcc", flags: ["-O2"], arch: "SuperH4" },
  { tag: "saturn", target: "saturn-gcc", flags: ["-O2"], arch: "SuperH" },
  { tag: "genesis", target: "genesis-gcc", flags: ["-O2"], arch: "68000" },
  { tag: "coff", target: "msvc-x64", flags: ["-O2"], arch: "x86_64" }
]

const LEAF = 0x401000
const CALLER = 0x401040
const COUNTER = 0x402000
const leafSource = "int leaf(int x) { return x + 4; }\n"
const callerSource = "extern int counter;\nint leaf(int x);\nint caller(int x) { return leaf(x) + counter; }\n"

const sh = (container: string, script: string): string =>
  execFileSync("docker", ["exec", container, "sh", "-c", script], { encoding: "utf8", maxBuffer: 64 << 20 })

/** Each source line as one single-quoted shell word (the sources have no quotes). */
const lines = (source: string): string =>
  source.trimEnd().split("\n").map((line) => `'${line}'`).join(" ")

const toolVar =(spec: { readonly env: string; readonly fallback: string }) => `\${${spec.env}:-${spec.fallback}}`

const reference = (container: string, target: MatchTarget, flags: ReadonlyArray<string>) => {
  const cc = toolVar(target.tools.c)
  const objdump = toolVar(target.tools.objdump)
  const ld = toolVar(target.tools.ld!)
  const quoted = flags.map((flag) => `'${flag}'`).join(" ")
  sh(container, [
    "set -e; rm -rf /tmp/ref; mkdir -p /tmp/ref; cd /tmp/ref",
    `printf '%s\\n' ${lines(leafSource)} > leaf.c`,
    `printf '%s\\n' ${lines(callerSource)} > caller.c`,
    `${cc} -c ${quoted} -o leaf.o leaf.c`,
    `${cc} -c ${quoted} -o caller.o caller.c`
  ].join("\n"))
  const leafTable = sh(container, `cd /tmp/ref && ${objdump} -t leaf.o`)
  const callerTable = sh(container, `cd /tmp/ref && ${objdump} -t caller.o`)
  const place = (table: string, name: string) => {
    // sh-elf and some others prefix C names with an underscore.
    const found = findObjectSymbol(table, name) ?? findObjectSymbol(table, `_${name}`)
    if (found === undefined) throw new Error(`${name} missing from reference object\n${table}`)
    const inCode = found.section.startsWith(".text")
    return { section: inCode ? found.section : ".text", offset: inCode ? found.value : 0, size: found.size }
  }
  const leaf = place(leafTable, "leaf")
  const caller = place(callerTable, "caller")
  const script = [
    "SECTIONS {",
    `  .ref.leaf 0x${(LEAF - leaf.offset).toString(16)} : { leaf.o(${leaf.section}) }`,
    `  .ref.caller 0x${(CALLER - caller.offset).toString(16)} : { caller.o(${caller.section}) }`,
    // counter lives in real small data, so base-relative access links too.
    `  .sdata 0x${COUNTER.toString(16)} : { _SDA_BASE_ = . + 0x8000; _gp = . + 0x7ff0; counter = .; _counter = .; . += 8; *(.sdata .sdata.* .sbss .sbss.* .scommon) }`,
    `  .ref.rest 0x410000 : { ${SCRATCH_INPUTS} }`,
    "}"
  ].join("\\n")
  sh(container, `cd /tmp/ref && printf '${script}\\n' > ref.ld && ${ld} ${(target.tools.ldFlags ?? []).join(" ")} -nostdlib --unresolved-symbols=ignore-all -T ref.ld -o ref.elf leaf.o caller.o`)
  const elf = Buffer.from(sh(container, "base64 -w0 /tmp/ref/ref.elf").trim(), "base64")
  const sections = readElfSections(elf)
  if ("reason" in sections) throw new Error(sections.reason)
  const placed = sections.find((item) => item.name === ".ref.caller")
  if (placed === undefined) throw new Error("reference caller section missing")
  const start = placed.fileOffset + caller.offset
  return Buffer.from(elf.subarray(start, start + caller.size))
}

const link = async (port: number, target: MatchTarget, c: Case, bytes: Buffer, counter: number) => {
  const res = await fetch(`http://127.0.0.1:${port}/v1/link-jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      jobId: crypto.randomUUID(),
      arch: c.arch,
      language: "c",
      toolchain: { compiler: "cc", version: "test", flags: c.flags, image: target.images[0] },
      headers: "",
      units: [{
        symbol: "caller",
        address: `0x${CALLER.toString(16)}`,
        size: bytes.length,
        originalBytesBase64: bytes.toString("base64"),
        source: callerSource
      }],
      symbols: [
        { name: "leaf", address: `0x${LEAF.toString(16)}` },
        { name: "counter", address: `0x${counter.toString(16)}` }
      ]
    })
  })
  const body = await res.json() as { diagnostics: string; units: Array<{ passed: boolean; detail: string }> }
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(body)}`)
  return body
}

const wanted = process.argv.slice(2)
const summary: Array<string> = []
let port = 3201
for (const c of cases) {
  if (wanted.length > 0 && !wanted.includes(c.tag) && !wanted.includes(c.target)) continue
  const target = matchTargets.find((item) => item.id === c.target)
  if (target === undefined) throw new Error(`no target ${c.target}`)
  const container = `rehydra-linktest-${c.tag}-run`
  const thisPort = port++
  let line: string
  try {
    execFileSync("docker", [
      "run", "-d", "--rm", "--name", container, "-p", `127.0.0.1:${thisPort}:3001`,
      "--security-opt", `seccomp=${seccomp}`, "-e", `MATCHD_TOKEN=${TOKEN}`, `rehydra-linktest-${c.tag}`
    ], { stdio: "ignore" })
    for (let i = 0; i < 30; i++) {
      const up = await fetch(`http://127.0.0.1:${thisPort}/v1/health`).then(() => true, () => false)
      if (up) break
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    if (target.tools.ld === undefined) {
      const body = await link(thisPort, target, c, Buffer.from([0x90]), COUNTER)
      const ok = /not available/.test(body.diagnostics)
      line = `${ok ? "PASS" : "FAIL"}  ${c.tag}: refused with a reason (${body.diagnostics})`
    } else {
      const bytes = reference(container, target, c.flags)
      const right = await link(thisPort, target, c, bytes, COUNTER)
      const wrong = await link(thisPort, target, c, bytes, COUNTER + 0x100)
      const r = right.units[0]
      const w = wrong.units[0]
      // Some targets reach globals through a base register, so the function's
      // bytes never hold the global's address and a wrong one cannot show:
      // PowerPC64 ELFv1 through the TOC, CodeWarrior through r13 small data.
      // The call to leaf is still checked there.
      const blanked = c.target === "ps3-gcc" ? ".toc" : c.target === "gamecube-mwcc" ? "counter" : undefined
      const ok = blanked !== undefined
        ? r?.passed === true && r.detail.endsWith(`not compared (${blanked})`)
        : r?.passed === true && !r.detail.includes("not compared") && w?.passed === false
      line = `${ok ? "PASS" : "FAIL"}  ${c.tag}: right=${r?.passed} (${(r?.detail ?? right.diagnostics).split("\n")[0]}) wrong=${w?.passed} (${(w?.detail ?? wrong.diagnostics).split("\n")[0]})`
    }
  } catch (error) {
    line = `FAIL  ${c.tag}: ${String(error).split("\n").slice(0, 6).join(" | ")}`
  } finally {
    try { execFileSync("docker", ["stop", container], { stdio: "ignore" }) } catch {}
  }
  console.log(line)
  summary.push(line)
}
const passed = summary.filter((line) => line.startsWith("PASS")).length
console.log(`\n${passed}/${summary.length} targets passed`)
process.exit(passed === summary.length ? 0 : 1)
