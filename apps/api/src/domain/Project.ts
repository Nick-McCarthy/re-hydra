import { Schema } from "effect"
import { HttpApiError, HttpApiSchema } from "effect/http-api"
import { Uuid } from "./Uuid.js"

export const SourceLanguage = Schema.Literals(["c", "cpp"]).annotate({
  identifier: "SourceLanguage"
})

export type SourceLanguage = typeof SourceLanguage.Type

export const Toolchain = Schema.Struct({
  compiler: Schema.String,
  version: Schema.String,
  flags: Schema.Array(Schema.String),
  image: Schema.String
}).annotate({ identifier: "Toolchain" })

export type Toolchain = typeof Toolchain.Type

export const ProjectStats = Schema.Struct({
  open: Schema.Int,
  leased: Schema.Int,
  validating: Schema.Int,
  matched: Schema.Int,
  stale: Schema.Int,
  blocked: Schema.Int,
  total: Schema.Int
}).annotate({ identifier: "ProjectStats" })

export type ProjectStats = typeof ProjectStats.Type

/** Who may check out, submit, and propose types (audit A-012). */
export const CheckoutPolicy = Schema.Literals(["open", "members"]).annotate({ identifier: "CheckoutPolicy" })
export type CheckoutPolicy = typeof CheckoutPolicy.Type

export const ProjectSummary = Schema.Struct({
  id: Uuid,
  slug: Schema.String,
  name: Schema.String,
  description: Schema.String,
  homeRegion: Schema.String,
  language: Schema.String,
  toolchain: Toolchain,
  leaseHours: Schema.Int,
  maxHoldHours: Schema.Int,
  maxConcurrentLeases: Schema.Int,
  maxHeldChunks: Schema.Int,
  checkoutPolicy: CheckoutPolicy,
  followerCount: Schema.Int,
  lastActivityAt: Schema.String,
  stats: ProjectStats,
  createdAt: Schema.String
}).annotate({ identifier: "ProjectSummary" })

export type ProjectSummary = typeof ProjectSummary.Type

export const CreateProjectPayload = Schema.Struct({
  slug: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(64)),
  name: Schema.String.check(Schema.isMinLength(1)),
  description: Schema.optionalKey(Schema.String),
  homeRegion: Schema.String.check(Schema.isMinLength(1)),
  language: SourceLanguage,
  toolchain: Toolchain,
  leaseHours: Schema.optionalKey(Schema.Int),
  maxHoldHours: Schema.optionalKey(Schema.Int),
  maxConcurrentLeases: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(8))
  )
}).annotate({ identifier: "CreateProjectPayload" })

export type CreateProjectPayload = typeof CreateProjectPayload.Type

export const ProjectCreated = ProjectSummary.pipe(HttpApiSchema.status("Created"))

/** A compiler flag outside the allow-list for this toolchain (audit A-013). */
export class FlagsRejected extends HttpApiError.Problem<FlagsRejected>()("FlagsRejected", {
  type: "https://re-hydra.dev/problems/flags-rejected",
  status: 400,
  title: "Compiler flag not allowed"
}) {}

/**
 * The user may not work on this project (audit A-012): blocked by its owner
 * or a maintainer, or the project takes work from members only.
 */
export class ProjectAccessDenied extends HttpApiError.Problem<ProjectAccessDenied>()("ProjectAccessDenied", {
  type: "https://re-hydra.dev/problems/project-access-denied",
  status: 403,
  title: "Not allowed on this project"
}) {}

export const BlockedUser = Schema.Struct({
  userId: Uuid,
  displayName: Schema.String,
  blockedBy: Uuid,
  blockedByName: Schema.String,
  reason: Schema.String,
  createdAt: Schema.String
}).annotate({ identifier: "BlockedUser" })
export type BlockedUser = typeof BlockedUser.Type

export const BlockUserPayload = Schema.Struct({
  userId: Uuid,
  reason: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200)))
}).annotate({ identifier: "BlockUserPayload" })
export type BlockUserPayload = typeof BlockUserPayload.Type

/** Audit A-011. Roles that can be given by adding or changing a member. */
export const AssignableRole = Schema.Literals(["maintainer", "contributor"]).annotate({ identifier: "AssignableRole" })
export type AssignableRole = typeof AssignableRole.Type

export const ProjectMember = Schema.Struct({
  userId: Uuid,
  displayName: Schema.String,
  role: Schema.Literals(["owner", "maintainer", "contributor"]),
  joinedAt: Schema.String
}).annotate({ identifier: "ProjectMember" })
export type ProjectMember = typeof ProjectMember.Type

export const AddMemberPayload = Schema.Struct({
  userId: Uuid,
  role: AssignableRole
}).annotate({ identifier: "AddMemberPayload" })
export type AddMemberPayload = typeof AddMemberPayload.Type

export const ChangeRolePayload = Schema.Struct({
  role: AssignableRole
}).annotate({ identifier: "ChangeRolePayload" })
export type ChangeRolePayload = typeof ChangeRolePayload.Type

export const OwnershipOffer = Schema.Struct({
  id: Uuid,
  projectSlug: Schema.String,
  projectName: Schema.String,
  offeredBy: Uuid,
  offeredByName: Schema.String,
  offeredTo: Uuid,
  offeredToName: Schema.String,
  createdAt: Schema.String,
  expiresAt: Schema.String
}).annotate({ identifier: "OwnershipOffer" })
export type OwnershipOffer = typeof OwnershipOffer.Type

export const OfferOwnershipPayload = Schema.Struct({
  userId: Uuid
}).annotate({ identifier: "OfferOwnershipPayload" })
export type OfferOwnershipPayload = typeof OfferOwnershipPayload.Type

/** The offer, if any, that the caller made or received. Null for everyone else. */
export const OwnershipOfferState = Schema.Struct({
  offer: Schema.NullOr(OwnershipOffer)
}).annotate({ identifier: "OwnershipOfferState" })
export type OwnershipOfferState = typeof OwnershipOfferState.Type

/** Join requests: a refusal the user can act on (already asked, wait, not members-only). */
export class JoinRequestRefused extends HttpApiError.Problem<JoinRequestRefused>()("JoinRequestRefused", {
  type: "https://re-hydra.dev/problems/join-request-refused",
  status: 409,
  title: "Join request not possible"
}) {}

export const JoinRequest = Schema.Struct({
  id: Uuid,
  projectSlug: Schema.String,
  projectName: Schema.String,
  userId: Uuid,
  displayName: Schema.String,
  message: Schema.String,
  createdAt: Schema.String
}).annotate({ identifier: "JoinRequest" })
export type JoinRequest = typeof JoinRequest.Type

export const JoinRequestPayload = Schema.Struct({
  message: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200)))
}).annotate({ identifier: "JoinRequestPayload" })
export type JoinRequestPayload = typeof JoinRequestPayload.Type

/** The caller's own request on one project, and when they may ask again after a decline. */
export const MyJoinRequestState = Schema.Struct({
  request: Schema.NullOr(JoinRequest),
  retryAfter: Schema.NullOr(Schema.String)
}).annotate({ identifier: "MyJoinRequestState" })
export type MyJoinRequestState = typeof MyJoinRequestState.Type

/** For My work: requests waiting on you as an approver, and your own open ones. */
export const MyJoinRequests = Schema.Struct({
  waitingOnYou: Schema.Array(JoinRequest),
  yours: Schema.Array(JoinRequest)
}).annotate({ identifier: "MyJoinRequests" })
export type MyJoinRequests = typeof MyJoinRequests.Type
