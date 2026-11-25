import { Schema } from "effect"
import { HttpApiError, HttpApiSchema } from "effect/http-api"
import { Uuid } from "./Uuid.js"

export const Email = Schema.String.check(Schema.isMinLength(3))
  .check(Schema.isMaxLength(320))
  .annotate({ identifier: "Email" })

export type Email = typeof Email.Type

const accountEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const AccountEmail = Email.check(Schema.isPattern(accountEmailPattern)).annotate({
  identifier: "AccountEmail"
})

export const DisplayName = Schema.String.check(Schema.isMinLength(1))
  .check(Schema.isMaxLength(80))
  .annotate({ identifier: "DisplayName" })

export const Password = Schema.String.check(Schema.isMinLength(8))
  .check(Schema.isMaxLength(128))
  .annotate({ identifier: "Password" })

export const UserProfile = Schema.Struct({
  id: Uuid,
  email: Email,
  displayName: Schema.String,
  /** A site admin: handles reports and takedowns. */
  isAdmin: Schema.Boolean
}).annotate({ identifier: "UserProfile" })

export type UserProfile = typeof UserProfile.Type

export const SignUpPayload = Schema.Struct({
  email: AccountEmail,
  displayName: DisplayName,
  password: Password,
  /** Must be true: the person agrees to the content policy. */
  acceptPolicy: Schema.optionalKey(Schema.Boolean)
}).annotate({ identifier: "SignUpPayload" })

export type SignUpPayload = typeof SignUpPayload.Type

export const SignInPayload = Schema.Struct({
  email: AccountEmail,
  password: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(128))
}).annotate({ identifier: "SignInPayload" })

export type SignInPayload = typeof SignInPayload.Type

export const ChangePasswordPayload = Schema.Struct({
  currentPassword: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(128)),
  newPassword: Password
}).annotate({ identifier: "ChangePasswordPayload" })

export type ChangePasswordPayload = typeof ChangePasswordPayload.Type

export const PasswordResetRequestPayload = Schema.Struct({
  email: AccountEmail
}).annotate({ identifier: "PasswordResetRequestPayload" })

export type PasswordResetRequestPayload = typeof PasswordResetRequestPayload.Type

export const PasswordResetConfirmPayload = Schema.Struct({
  token: Schema.String.check(Schema.isMinLength(20)).check(Schema.isMaxLength(200)),
  newPassword: Password
}).annotate({ identifier: "PasswordResetConfirmPayload" })

export type PasswordResetConfirmPayload = typeof PasswordResetConfirmPayload.Type

/** The reset link is unknown, used, or expired. */
export class ResetRejected extends HttpApiError.Problem<ResetRejected>()("ResetRejected", {
  type: "https://re-hydra.dev/problems/reset-rejected",
  status: 400,
  title: "Reset link not valid"
}) {}

/** A site admin suspended this account under the content policy. */
export class AccountSuspended extends HttpApiError.Problem<AccountSuspended>()("AccountSuspended", {
  type: "https://re-hydra.dev/problems/account-suspended",
  status: 403,
  title: "Account suspended"
}) {}

export class AccountRejected extends HttpApiError.Problem<AccountRejected>()(
  "AccountRejected",
  {
    type: "https://re-hydra.dev/problems/account-rejected",
    status: 400,
    title: "Account rejected"
  }
) {}

export class EmailTaken extends HttpApiError.Problem<EmailTaken>()("EmailTaken", {
  type: "https://re-hydra.dev/problems/email-taken",
  status: 409,
  title: "Email already registered"
}) {}

/** Too many sign-in attempts for one email address (audit A-035). */
export class SignInLimited extends HttpApiError.Problem<SignInLimited>()(
  "SignInLimited",
  {
    type: "https://re-hydra.dev/problems/too-many-requests",
    status: 429,
    title: "Too many sign-in attempts"
  }
) {}

export class InvalidCredentials extends HttpApiError.Problem<InvalidCredentials>()(
  "InvalidCredentials",
  {
    type: "https://re-hydra.dev/problems/invalid-credentials",
    status: 401,
    title: "Sign-in failed"
  }
) {}

export class PasswordRejected extends HttpApiError.Problem<PasswordRejected>()(
  "PasswordRejected",
  {
    type: "https://re-hydra.dev/problems/password-rejected",
    status: 400,
    title: "Password rejected"
  }
) {}

export class TokenRejected extends HttpApiError.Problem<
  TokenRejected,
  { readonly brand: unique symbol }
>()("TokenRejected", {
  type: "https://re-hydra.dev/problems/token-rejected",
  status: 400,
  title: "Token rejected"
}) {}

export const AccessTokenLabel = Schema.String.check(Schema.isMinLength(1)).check(
  Schema.isMaxLength(80)
)

export const CreateAccessTokenPayload = Schema.Struct({
  label: AccessTokenLabel
}).annotate({ identifier: "CreateAccessTokenPayload" })

export type CreateAccessTokenPayload = typeof CreateAccessTokenPayload.Type

export const AccessTokenSummary = Schema.Struct({
  id: Uuid,
  label: Schema.String,
  createdAt: Schema.String,
  lastUsedAt: Schema.NullOr(Schema.String)
}).annotate({ identifier: "AccessTokenSummary" })

export type AccessTokenSummary = typeof AccessTokenSummary.Type

export const AccessTokenCreatedBody = Schema.Struct({
  id: Uuid,
  label: Schema.String,
  token: Schema.String,
  createdAt: Schema.String
}).annotate({ identifier: "AccessTokenCreatedBody" })

export type AccessTokenCreatedBody = typeof AccessTokenCreatedBody.Type

export const AccessTokenCreated = AccessTokenCreatedBody.pipe(HttpApiSchema.status("Created"))

export const SessionResponse = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.String,
  user: UserProfile
}).annotate({ identifier: "SessionResponse" })

export type SessionResponse = typeof SessionResponse.Type

export const SessionCreated = SessionResponse.pipe(HttpApiSchema.status("Created"))
