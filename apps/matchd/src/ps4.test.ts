import assert from "node:assert/strict"
import { test } from "node:test"
import { extractSymbolMachineCode, scoreMaskedBytes } from "./normalize.js"

const ps4Call = `
0000000000000000 <call1>:
       0: 55                           	pushq	%rbp
       1: 48 89 e5                     	movq	%rsp, %rbp
       4: e8 00 00 00 00               	callq	0x9 <call1+0x9>
		0000000000000005:  R_X86_64_PLT32	leaf-0x4
       9: 83 c0 01                     	addl	$1, %eax
       c: 5d                           	popq	%rbp
       d: c3                           	retq
       e: 66 90                        	nop
`

test("a PS4 PLT32 blanks the displacement and leaves the call opcode", () => {
  const extracted = extractSymbolMachineCode(ps4Call, "call1", 14)
  assert.equal(extracted.ok, true)
  if (!extracted.ok) return
  assert.deepEqual(extracted.relocations, [{ offset: 5, type: "R_X86_64_PLT32" }])
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
  assert.equal(scored.originalLines[13], "c3")
})
