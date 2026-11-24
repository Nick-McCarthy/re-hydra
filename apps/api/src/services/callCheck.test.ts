import assert from "node:assert/strict"
import { test } from "node:test"
import { findReferenceMismatch } from "./callCheck.js"

const known = [
  { name: "leaf", address: 0x401000n },
  { name: "caller", address: 0x401040n },
  { name: "decoy", address: 0x401080n }
]
const ref = (symbol: string, originalTarget: string) => ({ offset: 5, type: "R_X86_64_PLT32", symbol, originalTarget })

test("the right callee passes, including objdump's _ and . decorations", () => {
  assert.equal(findReferenceMismatch([ref("leaf", "0x401000")], known), undefined)
  assert.equal(findReferenceMismatch([ref("_leaf", "0x401000")], known), undefined)
  assert.equal(findReferenceMismatch([ref(".leaf", "0x401000")], known), undefined)
  assert.equal(findReferenceMismatch([ref("caller", "0x401040")], known), undefined) // recursion
})

test("calling a different known function is refused (the decoy case)", () => {
  const why = findReferenceMismatch([ref("decoy", "0x401000")], known)
  assert.match(why ?? "", /calls decoy at \+0x5, but the original calls leaf \(0x401000\)/)
})

test("calling an outside C function where the original calls a known one is refused", () => {
  assert.match(findReferenceMismatch([ref("printf", "0x401000")], known) ?? "", /calls printf .* original calls leaf/)
})

test("calling a known function where the original goes elsewhere is refused", () => {
  assert.match(findReferenceMismatch([ref("leaf", "0x500000")], known) ?? "", /refers to leaf .* 0x500000/)
})

test("references the project knows nothing about are not judged", () => {
  // Data, library calls, and anything the import does not list.
  assert.equal(findReferenceMismatch([ref("g_table", "0x600000")], known), undefined)
  assert.equal(findReferenceMismatch([ref("memcpy", "0x700000")], known), undefined)
})

test("mangled names are only checked against known functions", () => {
  // A C++ call to an outside mangled name where the original calls a known function: not judged by name.
  assert.equal(findReferenceMismatch([ref("_ZN3Foo3barEv", "0x401000")], known), undefined)
  // But a mangled name that is itself a known function at another address is still refused.
  const cpp = [...known, { name: "_ZN3Foo3barEv", address: 0x401100n }]
  assert.match(findReferenceMismatch([ref("_ZN3Foo3barEv", "0x401000")], cpp) ?? "", /calls _ZN3Foo3barEv/)
})
