import { Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { Uuid } from "./Uuid.js"

export const AttemptResult = Schema.Struct({
  attemptId: Uuid,
  chunkId: Uuid,
  jobId: Uuid,
  state: Schema.Literals(["queued", "validating", "finished"]),
  score: Schema.NullOr(Schema.Finite),
  matched: Schema.NullOr(Schema.Boolean),
  diagnostics: Schema.NullOr(Schema.String),
  leaseToken: Uuid
}).annotate({ identifier: "AttemptResult" })

export type AttemptResult = typeof AttemptResult.Type

export const AttemptSummary = Schema.Struct({
  id: Uuid,
  chunkId: Uuid,
  /** null once the person deleted their account ("deleted account"). */
  userId: Schema.NullOr(Uuid),
  displayName: Schema.NullOr(Schema.String),
  score: Schema.NullOr(Schema.Finite),
  matched: Schema.NullOr(Schema.Boolean),
  compilerOk: Schema.NullOr(Schema.Boolean),
  diagnostics: Schema.NullOr(Schema.String),
  best: Schema.Boolean,
  createdAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String)
}).annotate({ identifier: "AttemptSummary" })

export type AttemptSummary = typeof AttemptSummary.Type

export const SubmitPayload = Schema.Struct({
  leaseToken: Uuid,
  source: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200_000))
}).annotate({ identifier: "SubmitPayload" })

export type SubmitPayload = typeof SubmitPayload.Type

export const AttemptAccepted = AttemptResult.pipe(HttpApiSchema.status("Accepted"))
