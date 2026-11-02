import { Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { Uuid } from "./Uuid.js"

export const Email = Schema.String.check(Schema.isMinLength(3))
  .check(Schema.isMaxLength(320))
  .annotate({ identifier: "Email" })

export type Email = typeof Email.Type

export const UserProfile = Schema.Struct({
  id: Uuid,
  email: Email,
  displayName: Schema.String
}).annotate({ identifier: "UserProfile" })

export type UserProfile = typeof UserProfile.Type

export const RequestMagicLinkPayload = Schema.Struct({
  email: Email,
  displayName: Schema.optionalKey(
    Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(80))
  )
}).annotate({ identifier: "RequestMagicLinkPayload" })

export type RequestMagicLinkPayload = typeof RequestMagicLinkPayload.Type

export const MagicLinkRequested = Schema.Struct({
  ok: Schema.Literal(true),
  /** Present only when AUTH_EXPOSE_DEV_TOKEN=true (local console mailer). */
  devToken: Schema.optionalKey(Schema.String)
}).pipe(HttpApiSchema.status("Accepted")).annotate({
  identifier: "MagicLinkRequested"
})

export const ConsumeMagicLinkPayload = Schema.Struct({
  token: Schema.String.check(Schema.isMinLength(16)).check(Schema.isMaxLength(128))
}).annotate({ identifier: "ConsumeMagicLinkPayload" })

export type ConsumeMagicLinkPayload = typeof ConsumeMagicLinkPayload.Type

export const SessionResponse = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.String,
  user: UserProfile
}).annotate({ identifier: "SessionResponse" })

export type SessionResponse = typeof SessionResponse.Type

export const SessionCreated = SessionResponse.pipe(HttpApiSchema.status("Created"))
