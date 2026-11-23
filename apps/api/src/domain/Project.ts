import { Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"
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
