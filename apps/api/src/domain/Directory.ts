import { Schema } from "effect"
import { SourceLanguage } from "./Project.js"
import { Uuid } from "./Uuid.js"

export const ProjectEventKind = Schema.Literals([
  "checkout",
  "release",
  "lease_expired",
  "lease_cleared",
  "matched",
  "match_missed",
  "imported",
  "proposal_opened",
  "proposal_ready",
  "proposal_accepted",
  "fused",
  "unresolved_marked",
  "unresolved_cleared",
  "became_stale",
  "settings_changed",
  "integration_started",
  "integration_passed",
  "integration_failed",
  "integration_reopened"
]).annotate({ identifier: "ProjectEventKind" })

export type ProjectEventKind = typeof ProjectEventKind.Type

export const ProjectEvent = Schema.Struct({
  id: Uuid,
  projectId: Uuid,
  projectSlug: Schema.String,
  projectName: Schema.String,
  actorId: Schema.optionalKey(Uuid),
  actorName: Schema.optionalKey(Schema.String),
  kind: ProjectEventKind,
  chunkId: Schema.optionalKey(Uuid),
  chunkName: Schema.optionalKey(Schema.String),
  summary: Schema.String,
  createdAt: Schema.String
}).annotate({ identifier: "ProjectEvent" })

export type ProjectEvent = typeof ProjectEvent.Type

export const FollowState = Schema.Struct({
  following: Schema.Boolean
}).annotate({ identifier: "FollowState" })

export type FollowState = typeof FollowState.Type

export const UserSearchHit = Schema.Struct({
  id: Uuid,
  displayName: Schema.String,
  reputation: Schema.Int,
  survivingMatches: Schema.Int,
  /** Surviving matches that used inline assembly. Not counted in reputation. */
  assemblyMatches: Schema.Int,
  regressions: Schema.Int,
  createdAt: Schema.String
}).annotate({ identifier: "UserSearchHit" })

export type UserSearchHit = typeof UserSearchHit.Type

export const FollowedProject = Schema.Struct({
  slug: Schema.String,
  name: Schema.String,
  description: Schema.String,
  language: Schema.String
}).annotate({ identifier: "FollowedProject" })

export type FollowedProject = typeof FollowedProject.Type

const CompilerFlag = Schema.String.check(Schema.isMinLength(2))
  .check(Schema.isMaxLength(64))
  .check(Schema.isPattern(/^-[0-9A-Za-z_.=+,:@/-]+$/))

export const UpdateProjectSettings = Schema.Struct({
  maxConcurrentLeases: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(8))
  ),
  maxHeldChunks: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(32))
  ),
  language: Schema.optionalKey(SourceLanguage),
  flags: Schema.optionalKey(
    Schema.Array(CompilerFlag).check(Schema.isMinLength(1)).check(Schema.isMaxLength(16))
  )
}).annotate({ identifier: "UpdateProjectSettings" })

export type UpdateProjectSettings = typeof UpdateProjectSettings.Type

/** Wrap a search string for ILIKE ... ESCAPE '\\'. Empty input means no filter. */
export const likeContains = (raw: string | undefined): string | null => {
  const trimmed = raw?.trim() ?? ""
  if (trimmed.length === 0) return null
  return `%${trimmed.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`
}
