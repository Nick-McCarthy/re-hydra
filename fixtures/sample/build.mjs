/**
 * Compile funcs.c the way matchd compiles a candidate (`gcc -O2 -c -I. -include types.h`)
 * and write export.json for the sample project seed.
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

const run = (args) =>
  execFileSync("docker", ["run", "--rm", "-v", `${dir}:/src`, "-w", "/src", image, ...args], {
    encoding: "utf8"
  })

run([
  "gcc",
  "-O2",
  "-c",
  "-I.",
  "-include",
  "types.h",
  "-o",
  "funcs.o",
  "funcs.c"
])

const gccVersion = run(["gcc", "-dumpversion"]).trim()
const dump = run(["objdump", "-d", "funcs.o"])
const objectBytes = readFileSync(join(dir, "funcs.o"))
const binarySha256 = createHash("sha256").update(objectBytes).digest("hex")

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
  const raw = insn[1].trim().split(/\s+/)
  current.bytes.push(...raw.map((b) => Number.parseInt(b, 16)))
  const asm = insn[2].replace(/\s+/g, " ").trim()
  current.disassembly.push(`  ${asm}`)
}
if (current) functions.push(current)

const wanted = ["skip_space", "header_size", "parse_header"]
const byName = new Map(functions.map((fn) => [fn.name, fn]))
for (const name of wanted) {
  if (!byName.has(name)) {
    throw new Error(`objdump did not contain ${name}`)
  }
}

const addressOf = (name) => `0x${byName.get(name).address.toString(16)}`

const pseudocode = {
  skip_space: "int skip_space(const char *p) {\n  return *p == ' ';\n}\n",
  header_size:
    "int header_size(Header *h) {\n  if (h->length < 0) {\n    return 0;\n  }\n  return h->length;\n}\n",
  parse_header:
    "int parse_header(Header *h, const char *p) {\n  if (skip_space(p)) {\n    return header_size(h);\n  }\n  return 0;\n}\n"
}

const typesUsed = {
  skip_space: [],
  header_size: ["Header"],
  parse_header: ["Header"]
}

const callees = {
  skip_space: [],
  header_size: [],
  parse_header: [addressOf("skip_space"), addressOf("header_size")]
}

const exportJson = {
  binarySha256,
  arch: "x86_64",
  name: "sample.o",
  language: "c",
  toolchain: {
    compiler: "gcc",
    version: gccVersion,
    flags: ["-O2"],
    image: "ghcr.io/re-hydra/gcc:host"
  },
  types: readFileSync(join(dir, "types.h"), "utf8").replace(/\r\n/g, "\n"),
  functions: wanted.map((name) => {
    const fn = byName.get(name)
    return {
      name,
      address: addressOf(name),
      size: fn.bytes.length,
      bytesBase64: Buffer.from(fn.bytes).toString("base64"),
      pseudocode: pseudocode[name],
      disassembly: `${fn.disassembly.join("\n")}\n`,
      ...(callees[name].length > 0 ? { callees: callees[name] } : {}),
      ...(typesUsed[name].length > 0 ? { typesUsed: typesUsed[name] } : {})
    }
  })
}

writeFileSync(join(dir, "export.json"), `${JSON.stringify(exportJson, null, 2)}\n`)
unlinkSync(join(dir, "funcs.o"))
console.log(`wrote ${wanted.length} functions, binary ${binarySha256.slice(0, 12)}…`)
for (const fn of exportJson.functions) {
  console.log(`  ${fn.name} @ ${fn.address} (${fn.size} bytes)`)
}
