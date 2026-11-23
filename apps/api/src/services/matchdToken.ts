import { Config, Effect, Redacted } from "effect"

/** The value in `.env.example` and the compose files. Never a production secret. */
export const DEV_MATCHD_TOKEN = "dev-matchd-token"

/**
 * `MATCHD_TOKEN` has no default (audit A-020). A missing value stops the API
 * at startup with a ConfigError. The dev value still works locally but logs a
 * warning every start. matchd has the same rule in `apps/matchd/src/matchdToken.ts`.
 */
export const loadMatchdToken = Effect.gen(function*() {
  const token = yield* Config.Redacted("MATCHD_TOKEN")
  if (Redacted.value(token).trim().length === 0) {
    return yield* Effect.die(new Error("MATCHD_TOKEN is empty. Set it to the secret matchd expects."))
  }
  if (Redacted.value(token) === DEV_MATCHD_TOKEN) {
    yield* Effect.logWarning(
      `MATCHD_TOKEN is the public development value '${DEV_MATCHD_TOKEN}'. Do not deploy with it.`
    )
  }
  return token
})
