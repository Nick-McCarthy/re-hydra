import assert from "node:assert/strict"
import { test } from "node:test"
import { extractSymbolMachineCode, scoreMaskedBytes } from "./normalize.js"
import { symbolSize } from "./symbols.js"

const callDump = `
0000000000000000 <call9>:
   0:\t48 83 ec 08          \tsub    $0x8,%rsp
   4:\te8 00 00 00 00       \tcall   9 <call9+0x9>
\t\t\t5: R_X86_64_PLT32\tleaf-0x4
   9:\t48 83 c4 08          \tadd    $0x8,%rsp
   d:\t83 c0 01             \tadd    $0x1,%eax
  10:\tc3                   \tret
`

const paddedDump = `
0000000000000000 <add1>:
   0:\t8d 47 01             \tlea    0x1(%rdi),%eax
   3:\tc3                   \tret
   4:\t66 66 2e 0f 1f 84 00 \tdata16 cs nopw 0x0(%rax,%rax,1)
   b:\t00 00 00 00
   f:\t90                   \tnop

0000000000000010 <and1>:
  10:\t89 f8                \tmov    %edi,%eax
  12:\t83 e0 01             \tand    $0x1,%eax
  15:\tc3                   \tret
`

test("nm -S size ignores the padding between symbols", () => {
  const nm = "0000000000000000 0000000000000004 T add1\n0000000000000010 0000000000000006 T and1\n"
  assert.equal(symbolSize(nm, "add1"), 4)
  assert.equal(symbolSize(nm, "and1"), 6)
})

test("symbol bytes stop at the symbol size", () => {
  const extracted = extractSymbolMachineCode(paddedDump, "add1", 4)
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual([...extracted.bytes], [0x8d, 0x47, 0x01, 0xc3])
  assert.equal(extracted.relocations.length, 0)
})

test("add and and stay different", () => {
  const add = Uint8Array.from([0x8d, 0x47, 0x01, 0xc3])
  const and = Uint8Array.from([0x89, 0xf8, 0x83, 0xe0, 0x01, 0xc3])
  const scored = scoreMaskedBytes(add, and, [])
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, false)
})

test("a different immediate is not a relocation", () => {
  const plus4 = Uint8Array.from([0x8d, 0x47, 0x04, 0xc3])
  const plus1 = Uint8Array.from([0x8d, 0x47, 0x01, 0xc3])
  const scored = scoreMaskedBytes(plus4, plus1, [])
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, false)
  assert.equal(scored.equalBytes, 3)
})

test("a linked call matches the unlinked object once the relocation is blanked", () => {
  const extracted = extractSymbolMachineCode(callDump, "call9", 0x11)
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [{ offset: 5, type: "R_X86_64_PLT32" }])
  const linked = Uint8Array.from([
    0x48, 0x83, 0xec, 0x08, 0xe8, 0xf7, 0xef, 0xbf, 0xff, 0x48, 0x83, 0xc4, 0x08, 0x83, 0xc0, 0x01, 0xc3
  ])
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations)
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.equal(scored.originalLines[4], "e8")
  assert.equal(scored.originalLines[5], "??")
  assert.equal(scored.candidateLines[4], "e8")
  assert.equal(scored.candidateLines[5], "??")
})

test("blanking a displacement does not blank the opcode", () => {
  const call = Uint8Array.from([0xe8, 0x11, 0x22, 0x33, 0x44])
  const jmp = Uint8Array.from([0xe9, 0xaa, 0xbb, 0xcc, 0xdd])
  const reloc = [{ offset: 1, type: "R_X86_64_PLT32" }]
  const same = scoreMaskedBytes(call, Uint8Array.from([0xe8, 0xaa, 0xbb, 0xcc, 0xdd]), reloc)
  const different = scoreMaskedBytes(call, jmp, reloc)
  assert.equal("reason" in same, false)
  assert.equal("reason" in different, false)
  if ("reason" in same || "reason" in different) return
  assert.equal(same.matched, true)
  assert.equal(different.matched, false)
  assert.equal(different.originalLines[0], "e8")
  assert.equal(different.candidateLines[0], "e9")
})

test("an unknown relocation is rejected", () => {
  const dump = `
0000000000000000 <f>:
   0:\te8 00 00 00 00       \tcall   0
\t\t\t1: R_X86_64_NOT_A_REAL_RELOC\tfoo
`
  const extracted = extractSymbolMachineCode(dump, "f", 5)
  assert.equal(extracted.ok, false)
  if (extracted.ok) return
  assert.match(extracted.reason, /unsupported relocation R_X86_64_NOT_A_REAL_RELOC/)
})
