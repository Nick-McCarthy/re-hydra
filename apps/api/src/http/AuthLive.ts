import { Effect, Option } from "effect"
import { Headers, HttpServerRequest } from "effect/http"
import { HttpApiBuilder } from "effect/http-api"
import { Unauthorized } from "effect/http-api/HttpApiError"
import { Api } from "../Api.js"
import { TokenRejected } from "../domain/Auth.js"
import { AuthRepo } from "../services/AuthRepo.js"
import { PasswordResets } from "../services/PasswordResets.js"
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
    .handle("signUp", (request) =>
      Effect.gen(function*() {
        const auth = yield* AuthRepo
        return yield* auth.signUp(request.payload)
      })
    )
    .handle("requestPasswordReset", (request) =>
      Effect.gen(function*() {
        const resets = yield* PasswordResets
        yield* resets.request(request.payload.email)
      })
    )
    .handle("confirmPasswordReset", (request) =>
      Effect.gen(function*() {
        const resets = yield* PasswordResets
        yield* resets.confirm(request.payload.token, request.payload.newPassword)
      })
    )
    .handle("signIn", (request) =>
      Effect.gen(function*() {
        const auth = yield* AuthRepo
        return yield* auth.signIn(request.payload)
      })
    )
    .handle("changePassword", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const auth = yield* AuthRepo
        return yield* auth.changePassword(user.id, request.payload)
      })
    )
    .handle("me", () => CurrentUser)
    .handle("createToken", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const auth = yield* AuthRepo
        const label = request.payload.label.trim()
        if (label.length === 0) {
          return yield* new TokenRejected({ detail: "Enter a name for this token." })
        }
        return yield* auth.createAccessToken(user.id, label)
      })
    )
    .handle("listTokens", () =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const auth = yield* AuthRepo
        return yield* auth.listAccessTokens(user.id)
      })
    )
    .handle("revokeToken", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const auth = yield* AuthRepo
        yield* auth.revokeAccessToken(user.id, request.params.tokenId)
      })
    )
    .handle("logout", () =>
      Effect.gen(function*() {
        yield* CurrentUser
        const token = yield* bearerFromRequest
        const auth = yield* AuthRepo
        yield* auth.revokeSessionByToken(token)
      })
    )
)
