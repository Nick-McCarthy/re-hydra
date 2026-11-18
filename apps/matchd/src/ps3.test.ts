import assert from "node:assert/strict"
import { test } from "node:test"
import { extractSymbolMachineCode, scoreMaskedBytes } from "./normalize.js"
import { symbolSize } from "./symbols.js"

const nm = `
0000000000000000 0000000000000038 D call1
                 U leaf
0000000000000018 000000000000001c D load
`

const dump = `
0000000000000000 <.call1>:
   0:\t7c 08 02 a6 \tmflr\tr0
   4:\tf8 01 00 10 \tstd\tr0,16(r1)
   8:\tf8 21 ff 91 \tstdu\tr1,-112(r1)
   c:\t48 00 00 01 \tbl\tc <.call1+0xc>
\t\t\tc: R_PPC64_REL24\tleaf
  10:\t60 00 00 00 \tnop
  14:\t38 21 00 70 \taddi\tr1,r1,112
  18:\te8 01 00 10 \tld\tr0,16(r1)
  1c:\t38 63 00 01 \taddi\tr3,r3,1
  20:\t7c 63 07 b4 \textsw\tr3,r3
  24:\t7c 08 03 a6 \tmtlr\tr0
  28:\t4e 80 00 20 \tblr
  2c:\t00 00 00 00 \t.long 0x0
  30:\t00 00 00 01 \t.long 0x1
  34:\t80 00 00 00 \tlwz\tr0,0(0)
  38:\t60 00 00 00 \tnop
  3c:\t60 00 00 00 \tnop

0000000000000040 <.load>:
  40:\t3d 22 00 00 \taddis\tr9,r2,0
\t\t\t42: R_PPC64_TOC16_HA\t.toc
  44:\te9 29 00 00 \tld\tr9,0(r9)
\t\t\t46: R_PPC64_TOC16_LO_DS\t.toc
  48:\te8 69 00 02 \tlwa\tr3,0(r9)
  4c:\t4e 80 00 20 \tblr
  50:\t00 00 00 00 \t.long 0x0
  54:\t00 00 00 00 \t.long 0x0
  58:\t00 00 00 00 \t.long 0x0
`

test("an ELFv1 descriptor symbol keeps the text size nm stores as data", () => {
  assert.equal(symbolSize(nm, "call1"), 0x38)
  assert.equal(symbolSize(nm, "load"), 0x1c)
})

test("a PS3 call follows the dot label and blanks the whole bl", () => {
  const extracted = extractSymbolMachineCode(dump, "call1", 0x38, undefined, "big")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.equal(extracted.bytes.length, 0x38)
  assert.deepEqual(extracted.relocations, [{ offset: 12, type: "R_PPC64_REL24" }])
  const linked = Uint8Array.from(extracted.bytes)
  linked[12] = 0x48
  linked[13] = 0x00
  linked[14] = 0x12
  linked[15] = 0x35
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, undefined, "big")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.equal(scored.originalLines[12], "??")
  assert.equal(scored.originalLines[15], "??")
  assert.equal(scored.originalLines[16], "60")
  assert.equal(scored.originalLines[0x2c], "00")
})

test("a PS3 load blanks the TOC halves and keeps the trailing traceback", () => {
  const extracted = extractSymbolMachineCode(dump, "load", 0x1c, undefined, "big")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [
    { offset: 2, type: "R_PPC64_TOC16_HA" },
    { offset: 6, type: "R_PPC64_TOC16_LO_DS" }
  ])
  const linked = Uint8Array.from(extracted.bytes)
  linked[2] = 0x80
  linked[3] = 0x12
  linked[6] = 0x34
  linked[7] = 0x56
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, undefined, "big")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.deepEqual(scored.originalLines.slice(0, 8), ["3d", "22", "??", "??", "e9", "29", "??", "??"])
  assert.equal(scored.originalLines[8], "e8")
  assert.equal(extracted.bytes.length, 0x1c)
})
