import assert from "node:assert/strict"
import { test } from "node:test"
import { extractSymbolMachineCode, scoreMaskedBytes } from "../normalize.js"
import { ppcFamily } from "./ppc.js"

const widths = ppcFamily.relocationWidth

test("a lis/addi pair keeps the opcodes and blanks the address halves", () => {
  const dump = `
00000000 <load>:
   0:\t3c600000 \tlis\tr3,0
\t\t\t2: R_PPC_ADDR16_HA\tg
   4:\t38630000 \taddi\tr3,r3,0
\t\t\t6: R_PPC_ADDR16_LO\tg
   8:\t4e800020 \tblr
`
  const extracted = extractSymbolMachineCode(dump, "load", 12, widths, "big")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  const linked = Uint8Array.from([
    0x3c, 0x60, 0x80, 0x12, 0x38, 0x63, 0x34, 0x56, 0x4e, 0x80, 0x00, 0x20
  ])
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, widths, "big")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.deepEqual(scored.originalLines, [
    "3c", "60", "??", "??", "38", "63", "??", "??", "4e", "80", "00", "20"
  ])
})

test("a bl blanks the LI field and keeps the opcode and LK bit", () => {
  const dump = `
00000000 <call1>:
   0:\t48000001 \tbl\t0
\t\t\t0: R_PPC_REL24\tleaf
   4:\t4e800020 \tblr
`
  const extracted = extractSymbolMachineCode(dump, "call1", 8, widths, "big")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  const linked = Uint8Array.from([0x48, 0x00, 0x12, 0x35, 0x4e, 0x80, 0x00, 0x20])
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, widths, "big")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.deepEqual(scored.originalLines, ["48", "??", "??", "?1", "4e", "80", "00", "20"])
})

test("a small-data load blanks the instruction that names r13", () => {
  const object = Uint8Array.from([0x80, 0x60, 0x00, 0x00, 0x4e, 0x80, 0x00, 0x20])
  const linked = Uint8Array.from([0x80, 0x6d, 0x00, 0x18, 0x4e, 0x80, 0x00, 0x20])
  const scored = scoreMaskedBytes(
    linked,
    object,
    [{ offset: 0, type: "R_PPC_EMB_SDA21" }],
    widths,
    "big"
  )
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.equal(scored.originalLines[4], "4e")
})

const wiiuLoad = `
00000030 <load>:
  30:\t3d 20 00 00 \tlis\tr9,0
\t\t\t32: R_PPC_ADDR16_HA\tg
  34:\t80 69 00 00 \tlwz\tr3,0(r9)
\t\t\t36: R_PPC_ADDR16_LO\tg
  38:\t4e 80 00 20 \tblr
`

test("a Wii U lis/lwz pair keeps the opcodes and blanks the address halves", () => {
  const extracted = extractSymbolMachineCode(wiiuLoad, "load", 12, widths, "big")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [
    { offset: 2, type: "R_PPC_ADDR16_HA" },
    { offset: 6, type: "R_PPC_ADDR16_LO" }
  ])
  const linked = Uint8Array.from([
    0x3d, 0x20, 0x80, 0x12, 0x80, 0x69, 0x34, 0x56, 0x4e, 0x80, 0x00, 0x20
  ])
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, widths, "big")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.deepEqual(scored.originalLines, [
    "3d", "20", "??", "??", "80", "69", "??", "??", "4e", "80", "00", "20"
  ])
})

test("Xbox 360 REL24 blanks the branch and REFHI blanks two bytes", () => {
  const branch = scoreMaskedBytes(
    Uint8Array.from([0x48, 0x00, 0x12, 0x35, 0x4e, 0x80, 0x00, 0x20]),
    Uint8Array.from([0x48, 0x00, 0x00, 0x01, 0x4e, 0x80, 0x00, 0x20]),
    [{ offset: 0, type: "IMAGE_REL_PPC_REL24" }],
    widths,
    "big"
  )
  assert.equal("reason" in branch, false)
  if ("reason" in branch) return
  assert.equal(branch.matched, true)
  assert.deepEqual(branch.originalLines.slice(0, 4), ["48", "??", "??", "?1"])
  const high = scoreMaskedBytes(
    Uint8Array.from([0x3d, 0x20, 0x80, 0x12]),
    Uint8Array.from([0x3d, 0x20, 0x00, 0x00]),
    [{ offset: 2, type: "IMAGE_REL_PPC_REFHI" }],
    widths,
    "big"
  )
  assert.equal("reason" in high, false)
  if ("reason" in high) return
  assert.equal(high.matched, true)
  assert.deepEqual(high.originalLines, ["3d", "20", "??", "??"])
})
