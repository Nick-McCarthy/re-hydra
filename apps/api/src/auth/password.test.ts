import assert from "node:assert/strict"
import { randomBytes, scryptSync } from "node:crypto"
import { test } from "node:test"
import { Effect } from "effect"
import { currentParams, hashPassword, needsRehash, verifyPassword } from "./password.js"

const run = <A>(effect: Effect.Effect<A, unknown>) => Effect.runPromise(effect)

test("new hashes use N = 2^17 and verify", async () => {
  const stored = await run(hashPassword("correct horse"))
  assert.match(stored, /^scrypt\$131072\$8\$1\$/)
  assert.equal(await run(verifyPassword("correct horse", stored)), true)
  assert.equal(await run(verifyPassword("wrong", stored)), false)
  assert.equal(needsRehash(stored), false)
  assert.equal(currentParams.N, 131072)
})

test("hashes made at the old cost still verify and are marked for rehash", async () => {
  const salt = randomBytes(16)
  const derived = scryptSync("old password", salt, 32, { N: 16384, r: 8, p: 1 })
  const old = `scrypt$16384$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`
  assert.equal(await run(verifyPassword("old password", old)), true)
  assert.equal(needsRehash(old), true)
})

test("absurd stored parameters are refused instead of computed", async () => {
  const huge = `scrypt$${2 ** 24}$8$1$${randomBytes(16).toString("base64url")}$${randomBytes(32).toString("base64url")}`
  assert.equal(await run(verifyPassword("x", huge)), false)
})
