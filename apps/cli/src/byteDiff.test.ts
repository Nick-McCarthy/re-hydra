import assert from "node:assert/strict"
import { test } from "node:test"
import { describeByteDiff, parseByteDiff } from "./byteDiff.js"

const miss = (original: Array<string>, candidate: Array<string>, extra: Array<string> = []) =>
  [
    `score=0.75000 equal=${original.filter((b, i) => b === candidate[i]).length}/${original.length} bytes`,
    "--- original (masked) ---",
    ...original,
    "--- candidate (masked) ---",
    ...candidate,
    ...extra
  ].join("\n")

test("finds the first differing byte and counts the rest", () => {
  const original = ["55", "48", "89", "e5", "8b", "45", "08", "??", "??", "c3"]
  const candidate = ["55", "48", "89", "e5", "8b", "45", "0c", "??", "??", "c9"]
  const diff = parseByteDiff(miss(original, candidate))!
  assert.equal(diff.firstDifference, 6)
  assert.equal(diff.differing, 2)
  assert.equal(diff.equalBytes, 8)
  assert.equal(diff.originalBytes, 10)
  assert.equal(diff.score, 0.75)
  assert.match(diff.window[0]!, /^original\s+\+0x0002\s+ 89  e5  8b  45 \[08\]/)
  assert.match(diff.window[1]!, /^candidate\s+\+0x0002\s+ 89  e5  8b  45 \[0c\]/)
  const text = describeByteDiff(diff).join("\n")
  assert.match(text, /first difference at \+0x0006 \(byte 6\); 2 of the first 10 bytes differ/)
})

test("a shorter candidate counts its missing bytes and says so", () => {
  const diff = parseByteDiff(miss(["55", "c3", "90"], ["55"]))!
  assert.equal(diff.firstDifference, 1)
  assert.equal(diff.differing, 2)
  assert.match(describeByteDiff(diff).join("\n"), /candidate is shorter: 1 bytes against 3/)
  assert.match(diff.window[1]!, /\[--\]/)
})

test("dumps that agree point past the dump", () => {
  const bytes = Array.from({ length: 80 }, () => "90")
  const text = miss(bytes, bytes).replace("equal=80/80", "equal=80/120")
  const diff = parseByteDiff(text)!
  assert.equal(diff.firstDifference, null)
  assert.match(describeByteDiff(diff).join("\n"), /first 80 bytes agree; the difference is further in/)
})

test("a call-target miss keeps its reason line out of the byte columns", () => {
  const diff = parseByteDiff(miss(["e8", "??"], ["e8", "??"], ["not a match: calls decoy where the original calls leaf"]))!
  assert.equal(diff.shown, 2)
  assert.equal(diff.firstDifference, null)
})

test("no comparison in compile errors or matches", () => {
  assert.equal(parseByteDiff("compile failed: candidate.c:3: error: expected ';'"), undefined)
  assert.equal(parseByteDiff("normalized byte match"), undefined)
  assert.equal(parseByteDiff(null), undefined)
})
