import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { readElfSections } from "./elf.js"
import { takeFunctionBytes } from "./link.js"
import { SCRATCH_INPUTS, buildLinkScript, findObjectSymbol, scratchAddress } from "./linkSymbols.js"

const image = Uint8Array.from([0x00, 0x8d, 0x47, 0x04, 0xc3, 0x90])
const section = { fileOffset: 1, size: 5 }

test("the function's own bytes are compared, not the padding after it", () => {
  assert.deepEqual(takeFunctionBytes(section, 0, 4, image, 4), Uint8Array.from([0x8d, 0x47, 0x04, 0xc3]))
})

test("a function longer than the original is rejected even when the original is its prefix", () => {
  assert.equal(takeFunctionBytes(section, 0, 5, image, 4), undefined)
  assert.equal(takeFunctionBytes(section, 0, 3, image, 4), undefined)
})

test("a function that runs past its section or the file is rejected", () => {
  assert.equal(takeFunctionBytes(section, 2, 4, image, 4), undefined)
  assert.equal(takeFunctionBytes({ fileOffset: 4, size: 4 }, 0, 4, image, 4), undefined)
})

test("a symbol's section, offset and size come from objdump -t", () => {
  const gnu = [
    "unit0.o:     file format elf64-x86-64",
    "",
    "SYMBOL TABLE:",
    "0000000000000000 l    df *ABS*\t0000000000000000 unit0.c",
    "0000000000000000 l    d  .text\t0000000000000000 .text",
    "0000000000000010 g     F .text\t0000000000000011 caller",
    "0000000000000000         *UND*\t0000000000000000 leaf"
  ].join("\n")
  assert.deepEqual(findObjectSymbol(gnu, "caller"), { section: ".text", value: 16, size: 17 })
  assert.equal(findObjectSymbol(gnu, "leaf"), undefined)
  const ppc64 = "0000000000000000 g     F .opd\t0000000000000030 caller"
  assert.deepEqual(findObjectSymbol(ppc64, "caller"), { section: ".opd", value: 0, size: 48 })
})

test("each unit's code is placed so its function starts at the original address", () => {
  const script = buildLinkScript(
    new Map([["leaf", 0x401000n]]),
    [{ output: ".rehydra.u0", file: "unit0.o", section: ".text", start: 0x401040n }],
    0x403000n
  )
  assert.equal(script, [
    "leaf = 0x401000;",
    "SECTIONS",
    "{",
    "  .rehydra.u0 0x401040 : { unit0.o(.text) }",
    "  .sdata 0x403000 : {",
    "    _SDA_BASE_ = . + 0x8000; _gp = . + 0x7ff0;",
    "    *(.sdata .sdata.* .sbss .sbss.* .scommon .lit4 .lit8)",
    "  }",
    "  .sdata2 : { _SDA2_BASE_ = . + 0x8000; *(.sdata2 .sdata2.* .sbss2 .sbss2.*) }",
    `  .rehydra.scratch : { ${SCRATCH_INPUTS} }`,
    "}"
  ].join("\n"))
  // A small-data global gets a placeholder inside .sdata, so the linker can
  // resolve the base-relative reference.
  assert.match(
    buildLinkScript(new Map(), [], 0x403000n, ["counter"]),
    /_gp = \. \+ 0x7ff0;\n {4}counter = \.; \. \+= 8;/
  )
})

test("the scratch region starts a page past the last function", () => {
  assert.equal(scratchAddress([0x401004n, 0x401051n]), 0x403000n)
  assert.equal(scratchAddress([0x402000n]), 0x403000n)
})

test("section headers are read from a real ELF file", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
  const sections = readElfSections(readFileSync(path.join(root, "fixtures/link/link.elf")))
  assert.ok(!("reason" in sections))
  const leaf = sections.find((item) => item.name === ".text.leaf")
  assert.deepEqual(leaf, { name: ".text.leaf", address: 0x401000n, fileOffset: 0x1000, size: 4, inFile: true })
  assert.equal(sections.find((item) => item.name === ".text.caller")?.address, 0x401040n)
  assert.deepEqual(readElfSections(Uint8Array.from([1, 2, 3])), { reason: "linked image is not ELF" })
})
