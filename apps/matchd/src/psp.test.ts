import assert from "node:assert/strict"
import { test } from "node:test"
import { mipsFamily } from "./families/mips.js"
import { extractSymbolMachineCode, scoreMaskedBytes } from "./normalize.js"

const widths = mipsFamily.relocationWidth

const dump = `
00000000 <call1>:
   0:\t27bdfff8 \taddiu\tsp,sp,-8
   4:\tafbf0004 \tsw\tra,4(sp)
   8:\t0c000000 \tjal\t0 <call1>
\t\t\t8: R_MIPS_26\tleaf
   c:\t00000000 \tnop
  10:\t8fbf0004 \tlw\tra,4(sp)
  14:\t24420001 \taddiu\tv0,v0,1
  18:\t03e00008 \tjr\tra
  1c:\t27bd0008 \taddiu\tsp,sp,8

00000020 <load>:
  20:\t03e00008 \tjr\tra
  24:\t8f820000 \tlw\tv0,0(gp)
\t\t\t24: R_MIPS_GPREL16\tg

00000028 <rev>:
  28:\t03e00008 \tjr\tra
  2c:\t7c041520 \tbitrev\tv0,a0
`

const zeroG = `
00000020 <load>:
  20:\t3c020000 \tlui\tv0,0x0
\t\t\t20: R_MIPS_HI16\tg
  24:\t03e00008 \tjr\tra
  28:\t8c420000 \tlw\tv0,0(v0)
\t\t\t28: R_MIPS_LO16\tg
`

test("a PSP jal has no paired R_MIPS_NONE and blanks the branch", () => {
  const extracted = extractSymbolMachineCode(dump, "call1", 0x20, widths, "little")
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

test("a PSP gp load blanks GPREL16 and keeps the Allegrex bitrev", () => {
  const load = extractSymbolMachineCode(dump, "load", 0x8, widths, "little")
  assert.equal(load.ok, true)
  if (!load.ok) return
  assert.deepEqual(load.relocations, [{ offset: 4, type: "R_MIPS_GPREL16" }])
  const linked = Uint8Array.from(load.bytes)
  linked[4] = 0x34
  linked[5] = 0x12
  const scored = scoreMaskedBytes(linked, load.bytes, load.relocations, widths, "little")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.deepEqual(scored.originalLines.slice(4), ["??", "??", "82", "8f"])

  const rev = extractSymbolMachineCode(dump, "rev", 0x8, widths, "little")
  assert.equal(rev.ok, true)
  if (!rev.ok) return
  assert.deepEqual(rev.relocations, [])
  assert.deepEqual(
    [...rev.bytes],
    [0x08, 0x00, 0xe0, 0x03, 0x20, 0x15, 0x04, 0x7c]
  )
})

test("a PSP -G0 address blanks HI16 and LO16", () => {
  const extracted = extractSymbolMachineCode(zeroG, "load", 0xc, widths, "little")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [
    { offset: 0, type: "R_MIPS_HI16" },
    { offset: 8, type: "R_MIPS_LO16" }
  ])
  const linked = Uint8Array.from(extracted.bytes)
  linked[0] = 0x12
  linked[1] = 0x34
  linked[8] = 0x56
  linked[9] = 0x78
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, widths, "little")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.deepEqual(scored.originalLines.slice(0, 4), ["??", "??", "02", "3c"])
  assert.equal(scored.originalLines[11], "8c")
})
