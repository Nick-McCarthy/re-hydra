import assert from "node:assert/strict"
import { test } from "node:test"
import { aarch64Family } from "./families/aarch64.js"
import { armFamily } from "./families/arm.js"
import { mipsFamily } from "./families/mips.js"
import { ppcFamily } from "./families/ppc.js"
import { type ObjectEndian, scoreMaskedBytes } from "./normalize.js"
import type { RelocField } from "./families/types.js"

/**
 * Audit A-006. A relocation blanks the bits the linker writes, not the opcode.
 * Each case pairs an original instruction with a candidate that differs only in
 * opcode or register bits that share a byte with the relocated field.
 */
const compare = (
  original: ReadonlyArray<number>,
  candidate: ReadonlyArray<number>,
  type: string,
  widths: Readonly<Record<string, RelocField>>,
  endian: ObjectEndian
) => {
  const scored = scoreMaskedBytes(
    Uint8Array.from(original),
    Uint8Array.from(candidate),
    [{ offset: 0, type }],
    widths,
    endian
  )
  assert.equal("reason" in scored, false)
  if ("reason" in scored) throw new Error(scored.reason)
  return scored
}

test("PowerPC REL24: a b does not match a bl", () => {
  const widths = ppcFamily.relocationWidth
  // bl 0x1234 linked vs b 0 in the object. Only the LK bit differs outside LI.
  assert.equal(compare([0x48, 0x00, 0x12, 0x35], [0x48, 0x00, 0x00, 0x00], "R_PPC_REL24", widths, "big").matched, false)
  assert.equal(compare([0x48, 0x00, 0x12, 0x35], [0x48, 0x00, 0x00, 0x01], "R_PPC_REL24", widths, "big").matched, true)
})

test("PowerPC EMB_SDA21: a stw does not match a lwz", () => {
  const widths = ppcFamily.relocationWidth
  // lwz r3, 0x10(r13) vs stw r3, 0(r0). Only the primary opcode differs.
  assert.equal(compare([0x80, 0x6d, 0x00, 0x10], [0x90, 0x60, 0x00, 0x00], "R_PPC_EMB_SDA21", widths, "big").matched, false)
  assert.equal(compare([0x80, 0x6d, 0x00, 0x10], [0x80, 0x60, 0x00, 0x00], "R_PPC_EMB_SDA21", widths, "big").matched, true)
  // A different destination register does not match either.
  assert.equal(compare([0x80, 0x6d, 0x00, 0x10], [0x80, 0x80, 0x00, 0x00], "R_PPC_EMB_SDA21", widths, "big").matched, false)
})

test("PowerPC REL14: a beq does not match a bne", () => {
  const widths = ppcFamily.relocationWidth
  // beq cr0, +0x10 vs bne cr0, 0. BO differs.
  assert.equal(compare([0x41, 0x82, 0x00, 0x10], [0x40, 0x82, 0x00, 0x00], "R_PPC_REL14", widths, "big").matched, false)
  assert.equal(compare([0x41, 0x82, 0x00, 0x10], [0x41, 0x82, 0x00, 0x00], "R_PPC_REL14", widths, "big").matched, true)
})

test("Thumb BL: a B.W does not match a BL, and BLX still matches BL", () => {
  const widths = armFamily.relocationWidth
  // Linked bl (f000 f818) vs object b.w (f7ff bffe). Bit 14 of the second halfword differs.
  assert.equal(compare([0x00, 0xf0, 0x18, 0xf8], [0xff, 0xf7, 0xfe, 0xbf], "R_ARM_THM_CALL", widths, "little").matched, false)
  assert.equal(compare([0x00, 0xf0, 0x18, 0xf8], [0xff, 0xf7, 0xfe, 0xff], "R_ARM_THM_CALL", widths, "little").matched, true)
  // The linker may turn BL into BLX (bit 12 cleared) for an ARM target.
  assert.equal(compare([0x00, 0xf0, 0x18, 0xe8], [0xff, 0xf7, 0xfe, 0xff], "R_ARM_THM_CALL", widths, "little").matched, true)
})

test("ARM MOVW: a different destination register does not match", () => {
  const widths = armFamily.relocationWidth
  // movw r0, #0x1234 vs movw r1, #0 (little-endian word e3010234 / e3001000).
  assert.equal(compare([0x34, 0x02, 0x01, 0xe3], [0x00, 0x10, 0x00, 0xe3], "R_ARM_MOVW_ABS_NC", widths, "little").matched, false)
  assert.equal(compare([0x34, 0x02, 0x01, 0xe3], [0x00, 0x00, 0x00, 0xe3], "R_ARM_MOVW_ABS_NC", widths, "little").matched, true)
})

test("MIPS R_MIPS_26: a j does not match a jal", () => {
  const widths = mipsFamily.relocationWidth
  // jal 0x408c0 vs j 0. The 6 opcode bits differ.
  assert.equal(compare([0x0c, 0x10, 0x20, 0x30], [0x08, 0x00, 0x00, 0x00], "R_MIPS_26", widths, "big").matched, false)
  assert.equal(compare([0x0c, 0x10, 0x20, 0x30], [0x0c, 0x00, 0x00, 0x00], "R_MIPS_26", widths, "big").matched, true)
})

test("AArch64 CALL26: a b does not match a bl", () => {
  const widths = aarch64Family.relocationWidth
  // bl vs b, little-endian. Bit 31 differs.
  assert.equal(compare([0x12, 0x34, 0x56, 0x97], [0x00, 0x00, 0x00, 0x14], "R_AARCH64_CALL26", widths, "little").matched, false)
  assert.equal(compare([0x12, 0x34, 0x56, 0x97], [0x00, 0x00, 0x00, 0x94], "R_AARCH64_CALL26", widths, "little").matched, true)
})
