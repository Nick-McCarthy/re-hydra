import assert from "node:assert/strict"
import { test } from "node:test"
import { shFamily } from "./families/sh.js"
import { extractSymbolMachineCode, scoreMaskedBytes } from "./normalize.js"

const widths = shFamily.relocationWidth

const dump = `
00000000 <call1>:
   0:\t03 d0       \tmov.l\t10 <call1+0x10>,r0\t! 0 <call1>
   2:\t22 4f       \tsts.l\tpr,@-r15
   4:\t0b 40       \tjsr\t@r0
   6:\t09 00       \tnop
   8:\t01 70       \tadd\t#1,r0
   a:\t26 4f       \tlds.l\t@r15+,pr
   c:\t0b 00       \trts
   e:\t09 00       \tnop
  10:\t00 00       \t.word 0x0000
\t\t\t10: R_SH_DIR32\tleaf
  12:\t00 00       \t.word 0x0000

00000014 <load>:
  14:\t01 d1       \tmov.l\t1c <load+0x8>,r1\t! 0 <call1>
  16:\t0b 00       \trts
  18:\t12 60       \tmov.l\t@r1,r0
  1a:\t09 00       \tnop
  1c:\t00 00       \t.word 0x0000
\t\t\t1c: R_SH_DIR32\tg
  1e:\t00 00       \t.word 0x0000

00000020 <fadd>:
  20:\t6a 01       \tsts\tfpscr,r1
  22:\t04 d2       \tmov.l\t34 <fadd+0x14>,r2\t! 80000
  24:\t2a 21       \txor\tr2,r1
  26:\t6a 41       \tlds\tr1,fpscr
  28:\t5c f0       \tfmov\tfr5,fr0
  2a:\t40 f0       \tfadd\tfr4,fr0
  2c:\t2a 21       \txor\tr2,r1
  2e:\t6a 41       \tlds\tr1,fpscr
  30:\t0b 00       \trts
  32:\t09 00       \tnop
  34:\t00 00       \t.word 0x0000
  36:\t08 00       \tclrt
`

const pic = `
00000000 <call1>:
   0:\t05 d1       \tmov.l\t18 <call1+0x18>,r1\t! 8
   2:\t06 c7       \tmova\t1c <call1+0x1c>,r0
   4:\tc6 2f       \tmov.l\tr12,@-r15
   6:\t05 dc       \tmov.l\t1c <call1+0x1c>,r12\t! 0 <call1>
   8:\t22 4f       \tsts.l\tpr,@-r15
   a:\t0c 3c       \tadd\tr0,r12
   c:\t03 01       \tbsrf\tr1
   e:\t09 00       \tnop
  10:\t01 70       \tadd\t#1,r0
  12:\t26 4f       \tlds.l\t@r15+,pr
  14:\t0b 00       \trts
  16:\tf6 6c       \tmov.l\t@r15+,r12
  18:\t08 00       \tclrt
  1a:\t00 00       \t.word 0x0000
\t\t\t18: R_SH_PLT32\tleaf
  1c:\t00 00       \t.word 0x0000
\t\t\t1c: R_SH_GOTPC\t_GLOBAL_OFFSET_TABLE_
  1e:\t00 00       \t.word 0x0000
`

test("a Dreamcast call blanks the DIR32 pool and leaves the jsr", () => {
  const call = extractSymbolMachineCode(dump, "call1", 0x14, widths, "little")
  assert.equal(call.ok, true)
  if (!call.ok) return
  assert.deepEqual(call.relocations, [{ offset: 0x10, type: "R_SH_DIR32" }])
  const linked = Uint8Array.from(call.bytes)
  linked[0x10] = 0x10
  linked[0x11] = 0x20
  linked[0x12] = 0x30
  linked[0x13] = 0x40
  const scored = scoreMaskedBytes(linked, call.bytes, call.relocations, widths, "little")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.equal(scored.originalLines[4], "0b")
  assert.equal(scored.originalLines[5], "40")
  assert.deepEqual(scored.originalLines.slice(0x10), ["??", "??", "??", "??"])

  const load = extractSymbolMachineCode(dump, "load", 0x0c, widths, "little")
  assert.equal(load.ok, true)
  if (!load.ok) return
  assert.deepEqual(load.relocations, [{ offset: 8, type: "R_SH_DIR32" }])
  assert.equal(load.bytes[4], 0x12)
  assert.equal(load.bytes[5], 0x60)
})

test("a Dreamcast fadd keeps the fadd opcode and the in-function constant", () => {
  const extracted = extractSymbolMachineCode(dump, "fadd", 0x18, widths, "little")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [])
  assert.equal(extracted.bytes[10], 0x40)
  assert.equal(extracted.bytes[11], 0xf0)
  assert.equal(extracted.bytes[20], 0x00)
  assert.equal(extracted.bytes[22], 0x08)
})

test("a Dreamcast PIC call blanks PLT32 and GOTPC", () => {
  const extracted = extractSymbolMachineCode(pic, "call1", 0x20, widths, "little")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [
    { offset: 0x18, type: "R_SH_PLT32" },
    { offset: 0x1c, type: "R_SH_GOTPC" }
  ])
  const linked = Uint8Array.from(extracted.bytes)
  linked[0x18] = 0x11
  linked[0x1c] = 0x22
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, widths, "little")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.equal(scored.originalLines[12], "03")
  assert.equal(scored.originalLines[0x18], "??")
  assert.equal(scored.originalLines[0x1c], "??")
})
