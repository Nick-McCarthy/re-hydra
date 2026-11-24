import assert from "node:assert/strict"
import { test } from "node:test"
import { FixedWindowLimiter, isImportPath, matchingRules } from "./rateLimit.js"

test("a window allows `limit` hits, then refuses with the time left", () => {
  const limiter = new FixedWindowLimiter()
  for (let i = 0; i < 3; i++) assert.equal(limiter.take("k", 3, 60_000, 1_000).ok, true)
  const refused = limiter.take("k", 3, 60_000, 31_000)
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.equal(refused.retryAfterSeconds, 30)
})

test("the window resets after windowMs", () => {
  const limiter = new FixedWindowLimiter()
  limiter.take("k", 1, 10_000, 0)
  assert.equal(limiter.take("k", 1, 10_000, 5_000).ok, false)
  assert.equal(limiter.take("k", 1, 10_000, 10_000).ok, true)
})

test("keys are independent", () => {
  const limiter = new FixedWindowLimiter()
  limiter.take("a", 1, 10_000, 0)
  assert.equal(limiter.take("a", 1, 10_000, 1).ok, false)
  assert.equal(limiter.take("b", 1, 10_000, 1).ok, true)
})

test("expired windows are pruned", () => {
  const limiter = new FixedWindowLimiter()
  for (let i = 0; i < 1200; i++) limiter.take(`key-${i}`, 5, 1_000, 0)
  limiter.take("late", 5, 1_000, 10_000)
  for (let i = 0; i < 1000; i++) limiter.take("late", 5000, 1_000, 10_000)
  assert.ok(limiter.size < 100, `size ${limiter.size}`)
})

test("route rules match the endpoints they name", () => {
  assert.deepEqual(matchingRules("POST", "/v1/auth/sign-in").map((r) => r.name), ["sign-in"])
  assert.deepEqual(matchingRules("GET", "/v1/auth/sign-in").map((r) => r.name), [])
  assert.deepEqual(matchingRules("POST", "/v1/projects/demo/chunks/abc/checkout").map((r) => r.name), ["checkout"])
  assert.deepEqual(matchingRules("POST", "/v1/projects").map((r) => r.name), ["create-project"])
  assert.equal(isImportPath("/v1/projects/demo/imports"), true)
  assert.equal(isImportPath("/v1/projects/demo/chunks"), false)
})
