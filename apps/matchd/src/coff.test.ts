import assert from "node:assert/strict"
import { test } from "node:test"
import { disassemblySize, extractSymbolMachineCode, scoreMaskedBytes } from "./normalize.js"

const coffCall = `
0000000000000000 <call1>:
       0: 48 83 ec 28                  	subq	$40, %rsp
       4: e8 00 00 00 00               	callq	0x9 <call1+0x9>
		0000000000000005:  IMAGE_REL_AMD64_REL32	leaf
       9: 83 c0 01                     	addl	$1, %eax
       c: 48 83 c4 28                  	addq	$40, %rsp
      10: c3                           	retq
`

test("COFF disassembly supplies the size nm does not store", () => {
  assert.equal(disassemblySize(coffCall, "call1"), 17)
})

test("an IMAGE_REL_AMD64_REL32 blanks the displacement and leaves the call opcode", () => {
  const extracted = extractSymbolMachineCode(coffCall, "call1", 17)
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [{ offset: 5, type: "IMAGE_REL_AMD64_REL32" }])
  const linked = Uint8Array.from(extracted.bytes)
  linked[5] = 0x12
  linked[6] = 0x34
  linked[7] = 0x56
  linked[8] = 0x78
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations)
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.equal(scored.originalLines[4], "e8")
  assert.equal(scored.originalLines[5], "??")
})

const xboxCall = `
00000000 <_call1>:
       0: ff 74 24 04                  	pushl	4(%esp)
       4: e8 00 00 00 00               	calll	0x9 <_call1+0x9>
			00000005:  IMAGE_REL_I386_REL32	_leaf
       9: 83 c4 04                     	addl	$4, %esp
       c: 83 c0 01                     	addl	$1, %eax
       f: c3                           	retl

00000010 <_load>:
      10: a1 00 00 00 00               	movl	0, %eax
			00000011:  IMAGE_REL_I386_DIR32	_g
      15: c3                           	retl
`

test("original Xbox COFF measures _call1 from the disassembly", () => {
  assert.equal(disassemblySize(xboxCall, "call1"), 16)
  assert.equal(disassemblySize(xboxCall, "load"), 6)
})

test("IMAGE_REL_I386_REL32 blanks the displacement and leaves the call opcode", () => {
  const extracted = extractSymbolMachineCode(xboxCall, "call1", 16)
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [{ offset: 5, type: "IMAGE_REL_I386_REL32" }])
  const linked = Uint8Array.from(extracted.bytes)
  linked[5] = 0x12
  linked[6] = 0x34
  linked[7] = 0x56
  linked[8] = 0x78
  const scored = scoreMaskedBytes(linked, extracted.bytes, extracted.relocations)
  assert.equal("reason" in scored, false)
  if ("reason" in scored) return
  assert.equal(scored.matched, true)
  assert.equal(scored.originalLines[4], "e8")
  assert.equal(scored.originalLines[5], "??")
  assert.equal(scored.originalLines[9], "83")
})
