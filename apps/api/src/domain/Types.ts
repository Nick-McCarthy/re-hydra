import { Schema } from "effect"
import { SymbolName } from "./Import.js"
import { HttpApiSchema } from "effect/http-api"
import { Uuid } from "./Uuid.js"

export const ProposalState = Schema.Literals([
  "open",
  "revalidating",
  "ready",
  "accepted",
  "rejected",
  "withdrawn"
]).annotate({ identifier: "ProposalState" })

export type ProposalState = typeof ProposalState.Type

export const TypeProposal = Schema.Struct({
  id: Uuid,
  projectId: Uuid,
  baseRevisionId: Uuid,
  title: Schema.String,
  description: Schema.String,
  state: ProposalState,
  createdBy: Uuid,
  revalidationStartedBy: Schema.optionalKey(Uuid),
  reviewedBy: Schema.optionalKey(Uuid),
  /** Owners and maintainers at the time the proposal was read. */
  reviewerCount: Schema.Int,
  resultingRevisionId: Schema.optionalKey(Uuid),
  /** Empty means every matched chunk is in scope. */
  affectedTypes: Schema.Array(Schema.String),
  /** Present on get and create. Omitted from the list to keep it small. */
  headers: Schema.optionalKey(Schema.String),
  revalidationTotal: Schema.Int,
  revalidationDone: Schema.Int,
  revalidationFailed: Schema.Int,
  /** Rechecks that could not run (compile failure, missing input). The match stays (audit A-026). */
  revalidationUnchecked: Schema.Int,
  createdAt: Schema.String,
  closedAt: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "TypeProposal" })

export type TypeProposal = typeof TypeProposal.Type

export const CreateTypeProposalPayload = Schema.Struct({
  title: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200)),
  description: Schema.optionalKey(Schema.String),
  /** Full replacement headers for the next type revision. */
  headers: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(500_000)),
  /**
   * Type names whose matched chunks must be revalidated.
   * Empty / omitted → all matched chunks in the project.
   */
  affectedTypes: Schema.optionalKey(Schema.Array(Schema.String))
}).annotate({ identifier: "CreateTypeProposalPayload" })

export type CreateTypeProposalPayload = typeof CreateTypeProposalPayload.Type

export const TypeProposalCreated = TypeProposal.pipe(HttpApiSchema.status("Created"))

/** Latest accepted headers plus type names referenced by chunks. */
export const TypeEnvironment = Schema.Struct({
  revision: Schema.Int,
  headers: Schema.String,
  createdAt: Schema.String,
  typeNames: Schema.Array(Schema.String)
}).annotate({ identifier: "TypeEnvironment" })

export type TypeEnvironment = typeof TypeEnvironment.Type

export const UnresolvedType = Schema.Struct({
  id: Uuid,
  projectId: Uuid,
  typeName: Schema.String,
  reason: Schema.String,
  createdBy: Uuid,
  createdAt: Schema.String,
  clearedAt: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "UnresolvedType" })

export type UnresolvedType = typeof UnresolvedType.Type

export const MarkUnresolvedPayload = Schema.Struct({
  typeName: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200)),
  reason: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "MarkUnresolvedPayload" })

export type MarkUnresolvedPayload = typeof MarkUnresolvedPayload.Type

export const UnresolvedMarked = UnresolvedType.pipe(HttpApiSchema.status("Created"))

export const FusePayload = Schema.Struct({
  chunkIds: Schema.Array(Uuid).check(Schema.isMinLength(2)),
  name: Schema.optionalKey(SymbolName)
}).annotate({ identifier: "FusePayload" })

export type FusePayload = typeof FusePayload.Type
