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
