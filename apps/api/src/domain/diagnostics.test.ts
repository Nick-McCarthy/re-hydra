import assert from "node:assert/strict"
import test from "node:test"
import { BYTES_HIDDEN_NOTE, hideBytes } from "./diagnostics.js"

test("a missed attempt keeps its score line and loses both byte dumps", () => {
  const text = [
    "score=0.75000 equal=3/4 bytes",
    "--- original (masked) ---",
    "8d",
    "47",
    "--- candidate (masked) ---",
    "8d",
    "48"
  ].join("\n")
  assert.equal(hideBytes(text), `score=0.75000 equal=3/4 bytes\n${BYTES_HIDDEN_NOTE}`)
})

test("an integration mismatch keeps the address and loses the hex lines", () => {
  const text = "mismatch at 0x401005\noriginal e8 00 00 00 00\nlinked   e8 f6 ff ff ff"
  assert.equal(hideBytes(text), `mismatch at 0x401005\n${BYTES_HIDDEN_NOTE}`)
})

test("text without bytes is unchanged", () => {
  for (const text of [
    "normalized byte match",
    "compile failed:\nfoo.c:1: error: expected ';'",
    "not a match: the candidate calls leaf at +0x5, but the original calls caller (0x401040) there",
    "original is 12 bytes, chunk size is 16"
  ]) {
    assert.equal(hideBytes(text), text)
  }
  assert.equal(hideBytes(null), null)
})
