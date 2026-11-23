import assert from "node:assert/strict"
import { test } from "node:test"
import { ConfigProvider, Effect, Exit, Redacted } from "effect"
import { DEV_MATCHD_TOKEN, loadMatchdToken, tokensEqual } from "./matchdToken.js"

const load = (env: Record<string, string>) =>
  Effect.runSyncExit(
    loadMatchdToken.pipe(Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env })))
  )

test("tokensEqual accepts the same token and refuses others", () => {
  assert.equal(tokensEqual("s3cret-token", "s3cret-token"), true)
  assert.equal(tokensEqual("s3cret-token", "s3cret-tokeN"), false)
  assert.equal(tokensEqual("", "s3cret-token"), false)
  assert.equal(tokensEqual("s3cret-token-and-more", "s3cret-token"), false)
})

test("MATCHD_TOKEN has no default (A-020)", () => {
  assert.equal(Exit.isFailure(load({})), true)
  assert.equal(Exit.isFailure(load({ MATCHD_TOKEN: "   " })), true)
})

test("MATCHD_TOKEN loads a real secret and still accepts the dev value", () => {
  const real = load({ MATCHD_TOKEN: "a-real-secret" })
  assert.equal(Exit.isSuccess(real), true)
  if (Exit.isSuccess(real)) assert.equal(Redacted.value(real.value), "a-real-secret")
  assert.equal(Exit.isSuccess(load({ MATCHD_TOKEN: DEV_MATCHD_TOKEN })), true)
})
