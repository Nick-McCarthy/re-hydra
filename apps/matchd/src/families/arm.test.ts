import assert from "node:assert/strict"
import { test } from "node:test"
import { extractSymbolMachineCode, scoreMaskedBytes } from "../normalize.js"
import { armFamily } from "./arm.js"

test("an ARM branch relocation blanks the immediate and leaves the opcode", () => {
  const widths = armFamily.relocationWidth
  assert.equal(widths.R_ARM_CALL, 3)
  assert.equal(widths.R_ARM_JUMP24, 3)
  assert.equal(widths.R_ARM_ABS32, 4)
  assert.deepEqual(widths.R_ARM_THM_CALL, { span: 4, unit: 2, fieldBits: [0x07ff, 0x3fff] })
  const linked = Uint8Array.from([0x12, 0x34, 0x56, 0xeb, 0x1e, 0xff, 0x2f, 0xe1])
  const object = Uint8Array.from([0x00, 0x00, 0x00, 0xeb, 0x1e, 0xff, 0x2f, 0xe1])
  const scored = scoreMaskedBytes(
    linked,
    object,
    [{ offset: 0, type: "R_ARM_CALL" }],
    widths
  )
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.deepEqual(scored.originalLines.slice(0, 4), ["??", "??", "??", "eb"])
})

test("agbcc thumb objdump is read in memory order", () => {
  const dump = `
00000000 <call1>:
   0:\tb500      \tpush\t{lr}
   2:\tf7ff fffe \tbl\t0 <leaf>
\t\t\t2: R_ARM_THM_CALL\tleaf
   6:\t3001      \tadds\tr0, #1
   8:\tbc02      \tpop\t{r1}
   a:\t4708      \tbx\tr1
`
  const extracted = extractSymbolMachineCode(dump, "call1", 12, armFamily.relocationWidth)
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(
    [...extracted.bytes],
    [0x00, 0xb5, 0xff, 0xf7, 0xfe, 0xff, 0x01, 0x30, 0x02, 0xbc, 0x08, 0x47]
  )
  assert.deepEqual(extracted.relocations, [{ offset: 2, type: "R_ARM_THM_CALL" }])
  const linked = Uint8Array.from([
    0x00, 0xb5, 0x00, 0xf0, 0x18, 0xf8, 0x01, 0x30, 0x02, 0xbc, 0x08, 0x47
  ])
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, armFamily.relocationWidth)
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.equal(scored.originalLines[0], "00")
  assert.equal(scored.originalLines[1], "b5")
  assert.equal(scored.originalLines[2], "??")
})

test("a thumb call blanks the immediate bits of both halfwords", () => {
  const linked = Uint8Array.from([0x00, 0xf0, 0x01, 0xf8])
  const object = Uint8Array.from([0xff, 0xf7, 0xfe, 0xff])
  const scored = scoreMaskedBytes(
    linked,
    object,
    [{ offset: 0, type: "R_ARM_THM_CALL" }],
    armFamily.relocationWidth
  )
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
})
