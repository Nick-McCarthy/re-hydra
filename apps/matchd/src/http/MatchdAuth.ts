import { Effect, Layer, Redacted } from "effect"
import { HttpApiError, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"
import { loadMatchdToken, tokensEqual } from "../matchdToken.js"

export class MatchdAuth extends HttpApiMiddleware.Service<
  MatchdAuth,
  {
    provides: never
    requires: never
  }
>()("rehydra/matchd/MatchdAuth", {
  requiredForClient: true,
  security: {
    bearer: HttpApiSecurity.bearer
  },
  error: HttpApiError.Unauthorized
}) {}

export const MatchdAuthLive = Layer.effect(
  MatchdAuth,
  Effect.gen(function*() {
    const expected = yield* loadMatchdToken

    return MatchdAuth.of({
      bearer: Effect.fn("MatchdAuth.bearer")(function*(httpEffect, { credential }) {
        if (!tokensEqual(Redacted.value(credential), Redacted.value(expected))) {
          return yield* new HttpApiError.Unauthorized()
        }
        return yield* httpEffect
      })
    })
  })
)
