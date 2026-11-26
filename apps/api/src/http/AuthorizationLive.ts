import { Context, Effect, Layer, Option, Redacted } from "effect"
import { Unauthorized } from "effect/http-api/HttpApiError"
import { TokenScopeRefused } from "../domain/Problems.js"
import { AuthRepo } from "../services/AuthRepo.js"
import { AllowWorkToken, Authorization, CurrentUser } from "./Authorization.js"

export const AuthorizationLive = Layer.effect(
  Authorization,
  Effect.gen(function*() {
    const auth = yield* AuthRepo

    return Authorization.of({
      bearer: Effect.fn("Authorization.bearer")(function*(httpEffect, { credential, endpoint }) {
        const token = Redacted.value(credential)
        const sessionUser = yield* auth.findUserBySessionToken(token)
        if (Option.isSome(sessionUser)) {
          return yield* Effect.provideService(httpEffect, CurrentUser, sessionUser.value)
        }
        const access = yield* auth.findUserByAccessToken(token)
        if (Option.isNone(access)) {
          return yield* new Unauthorized()
        }
        if (access.value.scope === "work" && !Context.get(endpoint.annotations, AllowWorkToken)) {
          return yield* new TokenScopeRefused({
            detail: "This token is for contributor work: check out, submit, heartbeat, release, and propose types. " +
              "Sign in, or use a full-access token, for anything else."
          })
        }
        return yield* Effect.provideService(httpEffect, CurrentUser, access.value.user)
      })
    })
  })
)
