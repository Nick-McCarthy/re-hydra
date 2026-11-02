import assert from "node:assert/strict"
import { test } from "node:test"
import { sameCompiler, toolchainDigest } from "./toolchain.js"

const compiler = "a".repeat(64)
const assembler = "b".repeat(64)
const otherCompiler = "c".repeat(64)

test("the digest names the compiler, the assembler, and the recipe", () => {
  const first = toolchainDigest(compiler, assembler, ["-O2"], "c")
  const again = toolchainDigest(compiler, assembler, ["-O2"], "c")
  assert.equal(first, again)
  assert.match(first, /^sha256:v2:[0-9a-f]{64}:[0-9a-f]{64}:[0-9a-f]{64}$/)
  assert.notEqual(first, toolchainDigest(compiler, assembler, ["-O0"], "c"))
  assert.notEqual(first, toolchainDigest(compiler, assembler, ["-O2"], "cpp"))
})

test("the same binaries match even when the recipe section differs", () => {
  const pinned = toolchainDigest(compiler, assembler, ["-O2"], "c")
  const rebuilt = toolchainDigest(compiler, assembler, ["-Os"], "c")
  assert.equal(sameCompiler(pinned, compiler, assembler), true)
  assert.equal(sameCompiler(rebuilt, compiler, assembler), true)
})

test("a different compiler or assembler is refused", () => {
  const pinned = toolchainDigest(compiler, assembler, ["-O2"], "c")
  assert.equal(sameCompiler(pinned, otherCompiler, assembler), false)
  assert.equal(sameCompiler(pinned, compiler, otherCompiler), false)
})

test("an older version-string digest is not a pin", () => {
  assert.equal(sameCompiler(`sha256:${"d".repeat(64)}`, compiler, assembler), true)
  assert.equal(sameCompiler(undefined, compiler, assembler), true)
})

test("a malformed v2 digest is refused", () => {
  assert.equal(sameCompiler("sha256:v2:not-a-hash", compiler, assembler), false)
  assert.equal(sameCompiler(`sha256:v2:${compiler}`, compiler, assembler), false)
  assert.equal(sameCompiler(`sha256:v2:${compiler}:${assembler}:short`, compiler, assembler), false)
})
