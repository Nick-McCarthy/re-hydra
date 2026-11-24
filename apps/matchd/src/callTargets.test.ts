import assert from "node:assert/strict"
import { test } from "node:test"
import { collectReferences, decodeOriginalTarget } from "./callTargets.js"
import { extractSymbolMachineCode } from "./normalize.js"

const bytes = (...b: Array<number>) => Uint8Array.from(b)
const hex = (v: bigint | undefined) => (v === undefined ? "undefined" : `0x${v.toString(16)}`)

test("x86 rel32 call: P + 4 + disp32", () => {
  // caller at 0x401040: push; call leaf (field at +5) -> leaf at 0x401000
  const original = bytes(0x55, 0x48, 0x89, 0xe5, 0xe8, 0xb7, 0xff, 0xff, 0xff)
  assert.equal(hex(decodeOriginalTarget("R_X86_64_PLT32", original, 5, 0x401040n, "little")), "0x401000")
  assert.equal(hex(decodeOriginalTarget("IMAGE_REL_AMD64_REL32", original, 5, 0x401040n, "little")), "0x401000")
})

test("ARM BL: P + 8 + imm24 << 2", () => {
  // bl at 0x08000100 to 0x08000000
  assert.equal(hex(decodeOriginalTarget("R_ARM_CALL", bytes(0xbe, 0xff, 0xff, 0xeb), 0, 0x08000100n, "little")), "0x8000000")
})

test("Thumb BL: split immediate, both old and new encodings", () => {
  // bl at 0x08000202 to 0x08000100
  assert.equal(hex(decodeOriginalTarget("R_ARM_THM_CALL", bytes(0x00, 0x00, 0xff, 0xf7, 0x7d, 0xff), 2, 0x08000200n, "little")), "0x8000100")
  // forward: bl at 0x08000000 to 0x08000030 (f000 f816)
  assert.equal(hex(decodeOriginalTarget("R_ARM_THM_CALL", bytes(0x00, 0xf0, 0x16, 0xf8), 0, 0x08000000n, "little")), "0x8000030")
})

test("AArch64 BL: P + imm26 << 2", () => {
  // bl at 0x80000008 to 0x80000000
  const original = bytes(0, 0, 0, 0, 0, 0, 0, 0, 0xfe, 0xff, 0xff, 0x97)
  assert.equal(hex(decodeOriginalTarget("R_AARCH64_CALL26", original, 8, 0x80000000n, "little")), "0x80000000")
})

test("MIPS jal: region of the next instruction | imm26 << 2", () => {
  assert.equal(hex(decodeOriginalTarget("R_MIPS_26", bytes(0x0c, 0x00, 0x01, 0x00), 0, 0x80001000n, "big")), "0x80000400")
  // little-endian PS1 encoding of the same instruction
  assert.equal(hex(decodeOriginalTarget("R_MIPS_26", bytes(0x00, 0x01, 0x00, 0x0c), 0, 0x80001000n, "little")), "0x80000400")
})

test("PowerPC bl: P + LI, or LI when AA is set", () => {
  // bl at 0x80003004 to 0x80003100
  assert.equal(hex(decodeOriginalTarget("R_PPC_REL24", bytes(0x60, 0x00, 0x00, 0x00, 0x48, 0x00, 0x00, 0xfd), 4, 0x80003000n, "big")), "0x80003100")
  // backwards: bl at 0x80003004 to 0x80003000 (LI = -4)
  assert.equal(hex(decodeOriginalTarget("R_PPC_REL24", bytes(0x00, 0x00, 0x00, 0x00, 0x4b, 0xff, 0xff, 0xfd), 4, 0x80003000n, "big")), "0x80003000")
})

test("absolute address words in either byte order", () => {
  assert.equal(hex(decodeOriginalTarget("R_PPC_ADDR32", bytes(0x80, 0x00, 0x31, 0x00), 0, 0n, "big")), "0x80003100")
  assert.equal(hex(decodeOriginalTarget("R_SH_DIR32", bytes(0x00, 0x31, 0x00, 0x8c), 0, 0n, "little")), "0x8c003100")
})

test("types that are not decoded give undefined", () => {
  assert.equal(decodeOriginalTarget("R_MIPS_HI16", bytes(0, 0, 0, 0), 0, 0n, "big"), undefined)
  assert.equal(decodeOriginalTarget("R_X86_64_PLT32", bytes(0, 0), 0, 0n, "little"), undefined)
})

test("objdump relocation symbols are kept without their addend, and sections are skipped", () => {
  const dump = `
0000000000000000 <caller>:
   0:\te8 00 00 00 00       \tcall   5 <caller+0x5>
\t\t\t1: R_X86_64_PLT32\tdecoy-0x4
   5:\t48 8d 05 00 00 00 00 \tlea    0x0(%rip),%rax
\t\t\t8: R_X86_64_PC32\t.rodata-0x4
   c:\tc3                   \tret
`
  const extracted = extractSymbolMachineCode(dump, "caller", 13)
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocationSymbols, ["decoy", ".rodata"])
  // Original: call leaf at 0x401000 from 0x401040.
  const original = bytes(0xe8, 0xbb, 0xff, 0xff, 0xff, 0x48, 0x8d, 0x05, 0, 0, 0, 0, 0xc3)
  const refs = collectReferences(extracted.relocations, extracted.relocationSymbols, original, 0x401040n, "little")
  assert.deepEqual(refs, [{ offset: 1, type: "R_X86_64_PLT32", symbol: "decoy", originalTarget: "0x401000" }])
})
