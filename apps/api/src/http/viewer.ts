import { Effect, Option } from "effect"
import { Headers, HttpServerRequest } from "effect/http"
import type { UserProfile } from "../domain/Auth.js"
import { AuthRepo } from "../services/AuthRepo.js"

/**
 * The signed-in user on a public endpoint, when the request carries a valid
 * session or access token. A missing or bad token is simply anonymous: these
 * endpoints answer everyone and only show more to some viewers.
 */
export const optionalViewer: Effect.Effect<
  Option.Option<UserProfile>,
  never,
  AuthRepo | HttpServerRequest.HttpServerRequest
> = Effect.gen(function*() {
  const request = yield* HttpServerRequest.HttpServerRequest
  const header = Headers.get(request.headers, "authorization")
  if (Option.isNone(header)) return Option.none()
  const match = /^Bearer\s+(.+)$/i.exec(header.value)
  const token = match?.[1]?.trim()
  if (!token) return Option.none()
  const auth = yield* AuthRepo
  const session = yield* auth.findUserBySessionToken(token)
  if (Option.isSome(session)) return session
  return yield* auth.findUserByAccessToken(token)
})
