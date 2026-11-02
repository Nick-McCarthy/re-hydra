import { Effect, Option } from "effect"
import { Headers, HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Unauthorized } from "effect/http-api/HttpApiError"
import { Api } from "../Api.js"
import { AuthRepo } from "../services/AuthRepo.js"
import { CurrentUser } from "./Authorization.js"

const bearerFromRequest = Effect.gen(function*() {
  const request = yield* HttpServerRequest.HttpServerRequest
  const header = Headers.get(request.headers, "authorization")
  if (Option.isNone(header)) {
    return yield* new Unauthorized()
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.value)
  if (match === null || match[1] === undefined) {
    return yield* new Unauthorized()
  }
  return match[1].trim()
})

export const AuthLive = HttpApiBuilder.group(Api, "auth", (handlers) =>
  handlers
    .handle("requestMagicLink", (request) =>
      Effect.gen(function*() {
        const auth = yield* AuthRepo
        return yield* auth.requestMagicLink(request.payload)
      })
    )
    .handle("consumeMagicLink", (request) =>
      Effect.gen(function*() {
        const auth = yield* AuthRepo
        return yield* auth.consumeMagicLink(request.payload)
      })
    )
    .handle("me", () => CurrentUser)
    .handle("logout", () =>
      Effect.gen(function*() {
        yield* CurrentUser
        const token = yield* bearerFromRequest
        const auth = yield* AuthRepo
        yield* auth.revokeSessionByToken(token)
      })
    )
)
