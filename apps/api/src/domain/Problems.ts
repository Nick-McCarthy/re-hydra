import { Schema } from "effect"
import { HttpApiError } from "effect/http-api"

/**
 * Refusals that say why (foundations plan, item 1).
 *
 * Each is an RFC 9457 problem with a `reason` code a client can branch on and
 * a `detail` sentence a person can read. They replace bare `Conflict` and
 * `BadRequest`, which left the CLI and agents guessing. Problems that share a
 * status are told apart by `type`.
 *
 * Deliberately vague answers stay vague: password reset never says whether an
 * account exists (audit A-040). Do not add reasons there.
 */

/** The request is well-formed but asks for something that cannot be done as written. */
export const InvalidRequestReason = Schema.Literals([
  "binary_required",
  "unknown_binary",
  "too_few_chunks",
  "different_programs",
  "empty_span",
  "nothing_to_change",
  "follow_self"
])
export type InvalidRequestReason = typeof InvalidRequestReason.Type

export class InvalidRequest extends HttpApiError.Problem<InvalidRequest>()("InvalidRequest", {
  type: "https://re-hydra.dev/problems/invalid-request",
  status: 400,
  title: "Request not valid"
}, { reason: InvalidRequestReason }) {}

/** Checkout, heartbeat, release, submit, bundle, and lease changes on one chunk. */
export const ChunkRefusedReason = Schema.Literals([
  /** Someone else holds the chunk. */
  "taken",
  /** You already hold it. */
  "already_held",
  "matched",
  "blocked",
  /** Part of a fused chunk; work on the fused one. */
  "fused",
  /** A submission is being checked. */
  "validating",
  /** The lease expired, was released, or was cleared. */
  "lease_gone",
  /** Only a leased chunk has a lease to clear. */
  "not_leased",
  /** The project has no type revision to compile against. */
  "no_types",
  /** The chunk changed while the request ran; trying again may work. */
  "changed"
])
export type ChunkRefusedReason = typeof ChunkRefusedReason.Type

export class ChunkRefused extends HttpApiError.Problem<ChunkRefused>()("ChunkRefused", {
  type: "https://re-hydra.dev/problems/chunk-refused",
  status: 409,
  title: "Not possible on this chunk now"
}, { reason: ChunkRefusedReason }) {}

export const IntegrationRefusedReason = Schema.Literals([
  "too_few_matches",
  "duplicate_names",
  "mixed_languages",
  "build_running",
  "recipe_check_running"
])
export type IntegrationRefusedReason = typeof IntegrationRefusedReason.Type

export class IntegrationRefused extends HttpApiError.Problem<IntegrationRefused>()("IntegrationRefused", {
  type: "https://re-hydra.dev/problems/integration-refused",
  status: 409,
  title: "Integration build not started"
}, { reason: IntegrationRefusedReason }) {}

export const ProposalRefusedReason = Schema.Literals([
  "no_type_revision",
  "not_open",
  "not_ready",
  /** With two or more reviewers, the person who started the recheck cannot accept. */
  "same_reviewer"
])
export type ProposalRefusedReason = typeof ProposalRefusedReason.Type

export class ProposalRefused extends HttpApiError.Problem<ProposalRefused>()("ProposalRefused", {
  type: "https://re-hydra.dev/problems/proposal-refused",
  status: 409,
  title: "Not possible on this type proposal now"
}, { reason: ProposalRefusedReason }) {}

/** Project-level refusals: creation, members, unresolved types, fusing. */
export const ProjectRefusedReason = Schema.Literals([
  "slug_taken",
  "already_member",
  "offer_open",
  "already_marked",
  "already_fused",
  "not_fusable",
  "bytes_missing",
  "changed"
])
export type ProjectRefusedReason = typeof ProjectRefusedReason.Type

export class ProjectRefused extends HttpApiError.Problem<ProjectRefused>()("ProjectRefused", {
  type: "https://re-hydra.dev/problems/project-refused",
  status: 409,
  title: "Not possible on this project now"
}, { reason: ProjectRefusedReason }) {}

/** The chunk changed between the write and the read back; the client may retry. */
export const chunkChanged = () =>
  new ChunkRefused({ reason: "changed", detail: "The chunk changed while this request ran. Try again." })

/** A `work` profile token was used for something only a full-access token or a session may do. */
export class TokenScopeRefused extends HttpApiError.Problem<TokenScopeRefused>()("TokenScopeRefused", {
  type: "https://re-hydra.dev/problems/token-scope-refused",
  status: 403,
  title: "Not allowed with this token"
}) {}
