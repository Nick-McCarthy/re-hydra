import { timingSafeEqual, createHash } from "node:crypto"
import { Config, Effect, Redacted } from "effect"

/** The value in `.env.example` and the compose files. Never a production secret. */
export const DEV_MATCHD_TOKEN = "dev-matchd-token"

/**
 * `MATCHD_TOKEN` has no default (audit A-020). A missing value stops startup
 * with a ConfigError. The dev value still works, so local compose and
 * `.env.example` keep running, but it logs a warning every start.
 */
export const loadMatchdToken = Effect.gen(function*() {
  const token = yield* Config.Redacted("MATCHD_TOKEN")
  if (Redacted.value(token).trim().length === 0) {
    return yield* Effect.die(new Error("MATCHD_TOKEN is empty. Set it to a shared secret."))
  }
  if (Redacted.value(token) === DEV_MATCHD_TOKEN) {
    yield* Effect.logWarning(
      `MATCHD_TOKEN is the public development value '${DEV_MATCHD_TOKEN}'. Do not deploy with it.`
    )
  }
  return token
})

/**
 * Constant-time bearer check (audit A-019). Both sides are hashed first so
 * the comparison has equal lengths and does not leak the token's length.
 */
export const tokensEqual = (presented: string, expected: string): boolean =>
  timingSafeEqual(
    createHash("sha256").update(presented, "utf8").digest(),
    createHash("sha256").update(expected, "utf8").digest()
  )
