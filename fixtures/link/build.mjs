/**
 * Link leaf, caller, and decoy at fixed addresses and write export.json.
 *
 * leaf and caller keep the bytes from that link. decoy is the same instruction
 * shape as caller, but its stored bytes are caller's, so an isolated normalized
 * match can succeed while the integration build reopens it.
 *
 * Requires the local matchd image (`docker compose build matchd`).
 */
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const dir = dirname(fileURLToPath(import.meta.url))
const image = process.env.SAMPLE_GCC_IMAGE ?? "re-hydra-matchd"

const files = {
  "types.h": "int leaf(int x);\nint caller(int x);\nint decoy(int x);\n",
  "leaf.c": "__attribute__((noinline))\nint leaf(int x) {\n  return x + 4;\n}\n",
  "caller.c": "__attribute__((noinline))\nint caller(int x) {\n  return leaf(x) + 1;\n}\n",
  "decoy.c": "__attribute__((noinline))\nint decoy(int x) {\n  return leaf(x) + 1;\n}\n"
}

for (const [name, text] of Object.entries(files)) {
  writeFileSync(join(dir, name), text)
}

const run = (args) =>
  execFileSync("docker", ["run", "--rm", "-v", `${dir}:/src`, "-w", "/src", image, ...args], {
    encoding: "utf8"
  })

const compileFlags = [
  "-O2",
  "-ffunction-sections",
  "-falign-functions=1",
  "-fno-asynchronous-unwind-tables",
  "-c",
  "-I.",
  "-include",
  "types.h"
]

for (const name of ["leaf", "caller", "decoy"]) {
  run(["gcc", ...compileFlags, "-o", `${name}.o`, `${name}.c`])
}

writeFileSync(
  join(dir, "link.ld"),
  [
    "SECTIONS",
    "{",
    "  .text.leaf 0x401000 : { *(.text.leaf) }",
    "  .text.caller 0x401040 : { *(.text.caller) }",
    "  .text.decoy 0x401080 : { *(.text.decoy) }",
    "}",
    ""
  ].join("\n")
)

run([
  "ld",
  "-nostdlib",
  "--unresolved-symbols=ignore-all",
  "-T",
  "link.ld",
  "-o",
  "image.elf",
  "leaf.o",
  "caller.o",
  "decoy.o"
])

const gccVersion = run(["gcc", "-dumpversion"]).trim()
const dump = run(["objdump", "-d", "image.elf"])
const elf = readFileSync(join(dir, "image.elf"))
const binarySha256 = createHash("sha256").update(elf).digest("hex")

const functions = []
const headerRe = /^([0-9a-fA-F]+)\s+<([^>]+)>:/
let current = null
for (const line of dump.split(/\r?\n/)) {
  const header = headerRe.exec(line)
  if (header) {
    if (current) functions.push(current)
    current = {
      name: header[2],
      address: Number.parseInt(header[1], 16),
      bytes: [],
      disassembly: [`${header[2]}:`]
    }
    continue
  }
  if (!current) continue
  const insn = /^\s+[0-9a-fA-F]+:\s+((?:[0-9a-fA-F]{2}\s+)+)\s*(.*)$/.exec(line)
  if (!insn) continue
  current.bytes.push(...insn[1].trim().split(/\s+/).map((byte) => Number.parseInt(byte, 16)))
  current.disassembly.push(`  ${insn[2].replace(/\s+/g, " ").trim()}`)
}
if (current) functions.push(current)

const byName = new Map(functions.map((fn) => [fn.name, fn]))
for (const name of ["leaf", "caller", "decoy"]) {
  if (!byName.has(name)) throw new Error(`objdump did not contain ${name}`)
}

const caller = byName.get("caller")
const decoy = byName.get("decoy")
decoy.bytes = [...caller.bytes]
decoy.disassembly = [
  "decoy:",
  "  ; stored bytes are caller's linked body, so this address will miss",
  ...caller.disassembly.slice(1)
]

const addressOf = (name) => `0x${byName.get(name).address.toString(16)}`
const exportJson = {
  binarySha256,
  binaryBase64: elf.toString("base64"),
  arch: "x86_64",
  name: "link.elf",
  language: "c",
  toolchain: {
    compiler: "gcc",
    version: gccVersion,
    flags: ["-O2"],
    image: "ghcr.io/re-hydra/gcc:host"
  },
  types: files["types.h"],
  functions: ["leaf", "caller", "decoy"].map((name) => {
    const fn = byName.get(name)
    return {
      name,
      address: addressOf(name),
      size: fn.bytes.length,
      bytesBase64: Buffer.from(fn.bytes).toString("base64"),
      pseudocode: files[`${name}.c`],
      disassembly: `${fn.disassembly.join("\n")}\n`,
      ...(name === "leaf" ? {} : { callees: [addressOf("leaf")] })
    }
  })
}

writeFileSync(join(dir, "export.json"), `${JSON.stringify(exportJson, null, 2)}\n`)
for (const name of ["leaf.o", "caller.o", "decoy.o", "image.elf", "link.ld"]) {
  unlinkSync(join(dir, name))
}
console.log(`wrote link export ${binarySha256.slice(0, 12)}…`)
for (const fn of exportJson.functions) {
  console.log(`  ${fn.name} @ ${fn.address} (${fn.size} bytes)`)
}
