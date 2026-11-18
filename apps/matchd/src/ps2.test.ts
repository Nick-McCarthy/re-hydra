import assert from "node:assert/strict"
import { test } from "node:test"
import { mipsFamily } from "./families/mips.js"
import { extractSymbolMachineCode, scoreMaskedBytes } from "./normalize.js"

const widths = mipsFamily.relocationWidth

const dump = `
0000000000000000 <call1>:
   0:\t67bdfff0 \tdaddiu\tsp,sp,-16
   4:\tffbf0008 \tsd\tra,8(sp)
   8:\t0c000000 \tjal\t0 <call1>
\t\t\t8: R_MIPS_26\tleaf
\t\t\t8: R_MIPS_NONE\t*ABS*
\t\t\t8: R_MIPS_NONE\t*ABS*
   c:\t00000000 \tnop
  10:\tdfbf0008 \tld\tra,8(sp)
  14:\t24420001 \taddiu\tv0,v0,1
  18:\t03e00008 \tjr\tra
  1c:\t67bd0010 \tdaddiu\tsp,sp,16

0000000000000020 <load>:
  20:\t3c020000 \tlui\tv0,0x0
\t\t\t20: R_MIPS_HIGHEST\tg
\t\t\t20: R_MIPS_NONE\t*ABS*
\t\t\t20: R_MIPS_NONE\t*ABS*
  24:\t64420000 \tdaddiu\tv0,v0,0
\t\t\t24: R_MIPS_HIGHER\tg
\t\t\t24: R_MIPS_NONE\t*ABS*
\t\t\t24: R_MIPS_NONE\t*ABS*
  28:\t3c030000 \tlui\tv1,0x0
\t\t\t28: R_MIPS_HI16\tg
\t\t\t28: R_MIPS_NONE\t*ABS*
\t\t\t28: R_MIPS_NONE\t*ABS*
  2c:\t0002103c \tdsll32\tv0,v0,0x0
  30:\t0043102d \tdaddu\tv0,v0,v1
  34:\t03e00008 \tjr\tra
  38:\t8c420000 \tlw\tv0,0(v0)
\t\t\t38: R_MIPS_LO16\tg
\t\t\t38: R_MIPS_NONE\t*ABS*
\t\t\t38: R_MIPS_NONE\t*ABS*
  3c:\t00000000 \tnop
`

test("a PS2 jal keeps the paired R_MIPS_NONE records and blanks the branch", () => {
  const extracted = extractSymbolMachineCode(dump, "call1", 0x20, widths, "little")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [
    { offset: 8, type: "R_MIPS_26" },
    { offset: 8, type: "R_MIPS_NONE" },
    { offset: 8, type: "R_MIPS_NONE" }
  ])
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

test("a PS2 64-bit address blanks HIGHEST, HIGHER, HI16, and LO16", () => {
  const extracted = extractSymbolMachineCode(dump, "load", 0x1c, widths, "little")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(
    extracted.relocations.filter((reloc) => reloc.type !== "R_MIPS_NONE"),
    [
      { offset: 0, type: "R_MIPS_HIGHEST" },
      { offset: 4, type: "R_MIPS_HIGHER" },
      { offset: 8, type: "R_MIPS_HI16" },
      { offset: 0x18, type: "R_MIPS_LO16" }
    ]
  )
  const linked = Uint8Array.from(extracted.bytes)
  linked[0] = 0x12
  linked[1] = 0x34
  linked[0x18] = 0x56
  linked[0x19] = 0x78
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, widths, "little")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.deepEqual(scored.originalLines.slice(0, 4), ["??", "??", "02", "3c"])
  assert.equal(scored.originalLines[0x1b], "8c")
})
