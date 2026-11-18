import assert from "node:assert/strict"
import { test } from "node:test"
import { armFamily } from "./families/arm.js"
import { extractSymbolMachineCode, scoreMaskedBytes } from "./normalize.js"

const widths = armFamily.relocationWidth

const arm11 = `
00000000 <call1>:
   0:\te92d4010 \tpush\t{r4, lr}
   4:\tebfffffe \tbl\t0 <leaf>
\t\t\t4: R_ARM_CALL\tleaf
   8:\te2800001 \tadd\tr0, r0, #1
   c:\te8bd8010 \tpop\t{r4, pc}

00000010 <load>:
  10:\te59f3004 \tldr\tr3, [pc, #4]\t@ 1c <load+0xc>
  14:\te5930000 \tldr\tr0, [r3]
  18:\te12fff1e \tbx\tlr
  1c:\t00000000 \t.word\t0x00000000
\t\t\t1c: R_ARM_ABS32\tg

00000020 <fadd>:
  20:\tee300a20 \tvadd.f32\ts0, s0, s1
  24:\te12fff1e \tbx\tlr
`

const thumb = `
00000000 <call1>:
   0:\tb510      \tpush\t{r4, lr}
   2:\tf7ff fffe \tbl\t0 <leaf>
\t\t\t2: R_ARM_THM_CALL\tleaf
   6:\t3001      \tadds\tr0, #1
   8:\tbd10      \tpop\t{r4, pc}
   a:\t46c0      \tnop\t\t\t@ (mov r8, r8)
`

test("an ARM11 bl blanks the immediate and the literal pool is the address", () => {
  const call = extractSymbolMachineCode(arm11, "call1", 0x10, widths, "little")
  assert.equal(call.ok, true)
  if (!call.ok) return
  assert.deepEqual(call.relocations, [{ offset: 4, type: "R_ARM_CALL" }])
  const linked = Uint8Array.from(call.bytes)
  linked[4] = 0x12
  linked[5] = 0x34
  linked[6] = 0x56
  const scored = scoreMaskedBytes(linked, call.bytes, call.relocations, widths, "little")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.deepEqual(scored.originalLines.slice(4, 8), ["??", "??", "??", "eb"])

  const load = extractSymbolMachineCode(arm11, "load", 0x10, widths, "little")
  assert.equal(load.ok, true)
  if (!load.ok) return
  assert.deepEqual(load.relocations, [{ offset: 0xc, type: "R_ARM_ABS32" }])
  const loadLinked = Uint8Array.from(load.bytes)
  loadLinked[0xc] = 0x78
  loadLinked[0xd] = 0x56
  loadLinked[0xe] = 0x34
  loadLinked[0xf] = 0x12
  const loadScored = scoreMaskedBytes(loadLinked, load.bytes, load.relocations, widths, "little")
  assert.equal("reason" in loadScored, false)
  if ("reason" in loadScored) return
  assert.equal(loadScored.matched, true)
  assert.deepEqual(loadScored.originalLines.slice(0xc), ["??", "??", "??", "??"])
})

test("an ARM11 hard-float add is the vadd bytes and has no relocation", () => {
  const extracted = extractSymbolMachineCode(arm11, "fadd", 0x8, widths, "little")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [])
  assert.deepEqual(
    [...extracted.bytes],
    [0x20, 0x0a, 0x30, 0xee, 0x1e, 0xff, 0x2f, 0xe1]
  )
})

test("an ARM11 Thumb bl blanks the pair and the alignment nop is outside the symbol", () => {
  const extracted = extractSymbolMachineCode(thumb, "call1", 0x0a, widths, "little")
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.equal(extracted.bytes.length, 0x0a)
  assert.deepEqual(extracted.relocations, [{ offset: 2, type: "R_ARM_THM_CALL" }])
  const linked = Uint8Array.from(extracted.bytes)
  linked[2] = 0x00
  linked[3] = 0xf0
  linked[4] = 0x18
  linked[5] = 0xf8
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations, widths, "little")
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.equal(scored.originalLines[2], "??")
  assert.equal(scored.originalLines[8], "10")
  assert.equal(scored.originalLines[9], "bd")
})
