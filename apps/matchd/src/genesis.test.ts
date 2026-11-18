import assert from "node:assert/strict"
import { test } from "node:test"
import { m68kFamily } from "./families/m68k.js"
import { extractSymbolMachineCode, scoreMaskedBytes } from "./normalize.js"

const widths = m68kFamily.relocationWidth

const dump = `
00000000 <call1>:
   0:\t2f2f 0004      \tmovel %sp@(4),%sp@-
   4:\t4eb9 0000 0000 \tjsr 0 <call1>
\t\t\t6: R_68K_32\tleaf
   a:\t588f           \taddql #4,%sp
   c:\t5280           \taddql #1,%d0
   e:\t4e75           \trts

00000010 <load>:
  10:\t2039 0000 0000 \tmovel 0 <call1>,%d0
\t\t\t12: R_68K_32\tg
  16:\t4e75           \trts

00000018 <add>:
  18:\t202f 0004      \tmovel %sp@(4),%d0
  1c:\td0af 0008      \taddl %sp@(8),%d0
  20:\t4e75           \trts
`

const pic = `
00000000 <call1>:
   0:\t2f0d           \tmovel %a5,%sp@-
   2:\t4bfa 0000      \tlea %pc@(4 <call1+0x4>),%a5
\t\t\t4: R_68K_GOT16\t_GLOBAL_OFFSET_TABLE_
   6:\t2f2f 0008      \tmovel %sp@(8),%sp@-
   a:\t206d 0000      \tmoveal %a5@(0),%a0
\t\t\tc: R_68K_GOT16O\tleaf
   e:\t4e90           \tjsr %a0@
  10:\t588f           \taddql #4,%sp
  12:\t5280           \taddql #1,%d0
  14:\t2a5f           \tmoveal %sp@+,%a5
  16:\t4e75           \trts
`

test("a Genesis call blanks the absolute address and leaves the jsr", () => {
  const call = extractSymbolMachineCode(dump, "call1", 0x10, widths, "big")
  assert.equal(call.ok, true)
  if (!call.ok) return
  assert.deepEqual(call.relocations, [{ offset: 6, type: "R_68K_32" }])
  assert.equal(call.bytes[4], 0x4e)
  assert.equal(call.bytes[5], 0xb9)
  const linked = Uint8Array.from(call.bytes)
  linked[6] = 0x10
  linked[7] = 0x20
  linked[8] = 0x30
  linked[9] = 0x40
  const scored = scoreMaskedBytes(linked, call.bytes, call.relocations, widths, "big")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.equal(scored.originalLines[4], "4e")
  assert.equal(scored.originalLines[5], "b9")
  assert.deepEqual(scored.originalLines.slice(6, 10), ["??", "??", "??", "??"])

  const load = extractSymbolMachineCode(dump, "load", 0x08, widths, "big")
  assert.equal(load.ok, true)
  if (!load.ok) return
  assert.deepEqual(load.relocations, [{ offset: 2, type: "R_68K_32" }])
  assert.equal(load.bytes[0], 0x20)
  assert.equal(load.bytes[1], 0x39)
})

test("a Genesis add has no relocation", () => {
  const extracted = extractSymbolMachineCode(dump, "add", 0x0a, widths, "big")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [])
  assert.equal(extracted.bytes[4], 0xd0)
  assert.equal(extracted.bytes[5], 0xaf)
  assert.equal(extracted.bytes[8], 0x4e)
  assert.equal(extracted.bytes[9], 0x75)
})

test("a Genesis PIC call blanks GOT16 and GOT16O", () => {
  const extracted = extractSymbolMachineCode(pic, "call1", 0x18, widths, "big")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [
    { offset: 4, type: "R_68K_GOT16" },
    { offset: 0xc, type: "R_68K_GOT16O" }
  ])
  const linked = Uint8Array.from(extracted.bytes)
  linked[4] = 0x11
  linked[0xc] = 0x22
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, widths, "big")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.equal(scored.originalLines[2], "4b")
  assert.equal(scored.originalLines[4], "??")
  assert.equal(scored.originalLines[12], "??")
  assert.equal(scored.originalLines[14], "4e")
})
