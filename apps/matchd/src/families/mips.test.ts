import assert from "node:assert/strict"
import { test } from "node:test"
import { extractSymbolMachineCode, scoreMaskedBytes } from "../normalize.js"
import { mipsFamily } from "./mips.js"

const widths = mipsFamily.relocationWidth

test("big-endian objdump words stay in memory order", () => {
  const dump = `
00000000 <add1>:
   0:\t24020001 \tli\tv0,1
   4:\t03e00008 \tjr\tra
   8:\t00000000 \tnop
`
  const extracted = extractSymbolMachineCode(dump, "add1", 12, widths, "big")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(
    [...extracted.bytes],
    [0x24, 0x02, 0x00, 0x01, 0x03, 0xe0, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00]
  )
})

test("a big-endian lui keeps its opcode and blanks the immediate", () => {
  const dump = `
00000000 <load>:
   0:\t3c020000 \tlui\tv0,0x0
\t\t\t0: R_MIPS_HI16\tg
   4:\t24420000 \taddiu\tv0,v0,0
\t\t\t4: R_MIPS_LO16\tg
   8:\t03e00008 \tjr\tra
   c:\t00000000 \tnop
`
  const extracted = extractSymbolMachineCode(dump, "load", 16, widths, "big")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  const linked = Uint8Array.from([
    0x3c, 0x02, 0x80, 0x12, 0x24, 0x42, 0x34, 0x56, 0x03, 0xe0, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00
  ])
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, widths, "big")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.deepEqual(scored.originalLines.slice(0, 8), ["3c", "02", "??", "??", "24", "42", "??", "??"])
})

test("a little-endian HI16 blanks the low half of the word", () => {
  const object = Uint8Array.from([0x00, 0x00, 0x02, 0x3c])
  const linked = Uint8Array.from([0x34, 0x12, 0x02, 0x3c])
  const scored = scoreMaskedBytes(linked, object, [{ offset: 0, type: "R_MIPS_HI16" }], widths, "little")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.deepEqual(scored.originalLines, ["??", "??", "02", "3c"])
})

test("jal blanks the whole instruction and leaves the delay slot", () => {
  const dump = `
00000000 <call1>:
   0:\t0c000000 \tjal\t0
\t\t\t0: R_MIPS_26\tleaf
   4:\t00000000 \tnop
`
  const extracted = extractSymbolMachineCode(dump, "call1", 8, widths, "big")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  const linked = Uint8Array.from([0x0c, 0x10, 0x20, 0x30, 0x00, 0x00, 0x00, 0x00])
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, widths, "big")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.deepEqual(scored.originalLines, ["??", "??", "??", "??", "00", "00", "00", "00"])
})

const ps1Call = `
00000000 <call1>:
   0:\t27bdffe8 \taddiu\tsp,sp,-24
   4:\tafbf0014 \tsw\tra,20(sp)
   8:\t0c000000 \tjal\t0 <call1>
\t\t\t8: R_MIPS_26\tleaf
   c:\t00000000 \tnop
  10:\t8fbf0014 \tlw\tra,20(sp)
  14:\t24420001 \taddiu\tv0,v0,1
  18:\t03e00008 \tjr\tra
  1c:\t27bd0018 \taddiu\tsp,sp,24
`

test("a little-endian PS1 jal blanks the branch and leaves the delay slot", () => {
  const extracted = extractSymbolMachineCode(ps1Call, "call1", 32, widths, "little")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [{ offset: 8, type: "R_MIPS_26" }])
  const linked = Uint8Array.from(extracted.bytes)
  linked[8] = 0x10
  linked[9] = 0x20
  linked[10] = 0x30
  linked[11] = 0x0c
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, widths, "little")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.equal(scored.originalLines[8], "??")
  assert.equal(scored.originalLines[12], "00")
})
