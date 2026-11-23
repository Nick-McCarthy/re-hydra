import { Schema } from "effect"
import { HttpApiError, HttpApiSchema } from "effect/http-api"
import { SourceLanguage } from "./Project.js"
import { Uuid } from "./Uuid.js"

export const ChunkState = Schema.Literals([
  "open",
  "leased",
  "validating",
  "matched",
  "stale",
  "blocked"
]).annotate({ identifier: "ChunkState" })

export type ChunkState = typeof ChunkState.Type

export const ChunkSummary = Schema.Struct({
  id: Uuid,
  projectId: Uuid,
  binaryId: Uuid,
  name: Schema.String,
  address: Schema.String,
  size: Schema.Int.check(Schema.isGreaterThan(0)),
  state: ChunkState,
  leaseUserId: Schema.optionalKey(Uuid),
  leaseExpiresAt: Schema.optionalKey(Schema.String),
  holdStartedAt: Schema.optionalKey(Schema.String),
  languageOverride: Schema.optionalKey(Schema.String),
  leaseCount: Schema.Int
}).annotate({ identifier: "ChunkSummary" })

export type ChunkSummary = typeof ChunkSummary.Type

export const SetChunkLanguage = Schema.Struct({
  language: Schema.NullOr(SourceLanguage)
}).annotate({ identifier: "SetChunkLanguage" })

export type SetChunkLanguage = typeof SetChunkLanguage.Type

/** The person already holds as many chunks as this project allows. */
export class CheckoutLimited extends HttpApiError.Problem<CheckoutLimited>()("CheckoutLimited", {
  type: "https://re-hydra.dev/problems/checkout-limited",
  status: 409,
  title: "Checkout limited"
}) {}

const LeaseBody = Schema.Struct({
  chunk: ChunkSummary,
  leaseToken: Uuid,
  leaseExpiresAt: Schema.String,
  holdStartedAt: Schema.String
})

export const LeaseResponse = LeaseBody.annotate({
  identifier: "LeaseResponse"
})

export type LeaseResponse = typeof LeaseResponse.Type

export const LeaseCreatedResponse = LeaseBody.pipe(
  HttpApiSchema.status("Created")
).annotate({
  identifier: "LeaseCreatedResponse"
})
