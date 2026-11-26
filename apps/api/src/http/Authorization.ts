import { Context } from "effect"
import { HttpApiError, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"
import type { UserProfile } from "../domain/Auth.js"
import { TokenScopeRefused } from "../domain/Problems.js"

export class CurrentUser extends Context.Service<CurrentUser, UserProfile>()(
  "rehydra/http/CurrentUser"
) {}

/**
 * Endpoint annotation: a `work` profile token may call this endpoint
 * (foundations plan 2). Everything else behind Authorization needs a session
 * or an `all` token. An allow-list, so a new endpoint is closed to agents
 * until someone decides otherwise.
 */
export const AllowWorkToken = Context.Reference<boolean>("rehydra/http/AllowWorkToken", {
  defaultValue: () => false
})

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
  error: [HttpApiError.Unauthorized, TokenScopeRefused]
}) {}
