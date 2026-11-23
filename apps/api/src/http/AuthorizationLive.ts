import { Effect, Layer, Option, Redacted } from "effect"
import { Unauthorized } from "effect/http-api/HttpApiError"
import { AuthRepo } from "../services/AuthRepo.js"
import { Authorization, CurrentUser } from "./Authorization.js"

export const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function*() {
    const auth = yield* AuthRepo

    return Authorization.of({
      bearer: Effect.fn("Authorization.bearer")(function*(httpEffect, { credential }) {
        const token = Redacted.value(credential)
        const sessionUser = yield* auth.findUserBySessionToken(token)
        if (Option.isSome(sessionUser)) {
          return yield* Effect.provideService(httpEffect, CurrentUser, sessionUser.value)
        }
        const accessUser = yield* auth.findUserByAccessToken(token)
        if (Option.isNone(accessUser)) {
          return yield* new Unauthorized()
        }
        return yield* Effect.provideService(httpEffect, CurrentUser, accessUser.value)
      })
    })
  })
)
