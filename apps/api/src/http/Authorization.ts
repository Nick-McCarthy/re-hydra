import { Context } from "effect"
import { HttpApiError, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"
import type { UserProfile } from "../domain/Auth.js"

export class CurrentUser extends Context.Service<CurrentUser, UserProfile>()(
  "rehydra/http/CurrentUser"
) {}

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  {
    provides: CurrentUser
    requires: never
  }
>()("rehydra/http/Authorization", {
  requiredForClient: true,
  security: {
    bearer: HttpApiSecurity.bearer
  },
  error: HttpApiError.Unauthorized
}) {}
