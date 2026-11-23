import assert from "node:assert/strict"
import { test } from "node:test"
import { extractSymbolMachineCode, scoreMaskedBytes } from "../normalize.js"
import { aarch64Family } from "./aarch64.js"

const widths = aarch64Family.relocationWidth

const dump = `
0000000000000000 <call1>:
       0: fd 7b bf a9  	stp	x29, x30, [sp, #-16]!
       4: fd 03 00 91  	mov	x29, sp
       8: 00 00 00 94  	bl	0x8 <call1+0x8>
		0000000000000008:  R_AARCH64_CALL26	leaf
       c: 00 04 00 11  	add	w0, w0, #1
      10: fd 7b c1 a8  	ldp	x29, x30, [sp], #16
      14: c0 03 5f d6  	ret

0000000000000018 <load>:
      18: 08 00 00 90  	adrp	x8, 0x0 <load>
		0000000000000018:  R_AARCH64_ADR_PREL_PG_HI21	g
      1c: 00 01 40 b9  	ldr	w0, [x8]
		000000000000001c:  R_AARCH64_LDST32_ABS_LO12_NC	g
      20: c0 03 5f d6  	ret
`

test("a CALL26 blanks the bl target and keeps the opcode bits", () => {
  const extracted = extractSymbolMachineCode(dump, "call1", 24, widths, "little")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [{ offset: 8, type: "R_AARCH64_CALL26" }])
  const linked = Uint8Array.from(extracted.bytes)
  linked[8] = 0x12
  linked[9] = 0x34
  linked[10] = 0x56
  linked[11] = 0x97
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, widths, "little")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.equal(scored.originalLines[4], "fd")
  assert.equal(scored.originalLines[7], "91")
  assert.equal(scored.originalLines[8], "??")
  assert.equal(scored.originalLines[11], "94")
  assert.equal(scored.originalLines[12], "00")
  assert.equal(scored.originalLines[23], "d6")
})

test("an ADRP and a page-offset load blank both instructions and leave the return", () => {
  const extracted = extractSymbolMachineCode(dump, "load", 12, widths, "little")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [
    { offset: 0, type: "R_AARCH64_ADR_PREL_PG_HI21" },
    { offset: 4, type: "R_AARCH64_LDST32_ABS_LO12_NC" }
  ])
  const linked = Uint8Array.from([
    0x28, 0x00, 0x00, 0xb0, 0x00, 0x21, 0x40, 0xb9, 0xc0, 0x03, 0x5f, 0xd6
  ])
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, widths, "little")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.deepEqual(scored.originalLines.slice(0, 8), ["??", "??", "??", "??", "??", "??", "??", "??"])
  assert.equal(scored.originalLines[8], "c0")
  assert.equal(scored.originalLines[11], "d6")
})
