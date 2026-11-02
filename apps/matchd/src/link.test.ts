import assert from "node:assert/strict"
import { test } from "node:test"
import { takeLinkedBytes } from "./link.js"

const elf = Uint8Array.from([0x8d, 0x47, 0x04, 0xc3, 0x90])

test("a section of the same length is the bytes to compare", () => {
  const linked = takeLinkedBytes(4, 0, elf, 4)
  assert.deepEqual(linked, Uint8Array.from([0x8d, 0x47, 0x04, 0xc3]))
})

test("a longer section is rejected when the original is only its prefix", () => {
  assert.equal(takeLinkedBytes(5, 0, elf, 4), undefined)
  assert.equal(takeLinkedBytes(4, 0, elf, 3), undefined)
})

test("a shorter section is rejected", () => {
  assert.equal(takeLinkedBytes(3, 0, elf, 4), undefined)
})

test("a section that runs past the file is rejected", () => {
  assert.equal(takeLinkedBytes(4, 2, elf, 4), undefined)
})
