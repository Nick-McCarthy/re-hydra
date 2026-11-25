import { Schema } from "effect"
import { HttpApiError } from "effect/http-api"
import { Uuid } from "./Uuid.js"

/**
 * The content policy a new account agrees to. Bump it when the published
 * policy changes, so the record shows which text each person accepted.
 */
export const POLICY_VERSION = "content-policy-draft-2026-11"

/** Content policy 2.4: submitted source is released under this (SPDX id). */
export const SOURCE_LICENSE = "CC0-1.0"

/**
 * Content policy section 3: an account with this many active strikes (not
 * reversed, younger than STRIKE_WINDOW_DAYS) is closed. Admins suspend by
 * hand, so a counter-notice can still reverse a strike first.
 */
export const STRIKE_LIMIT = 3
export const STRIKE_WINDOW_DAYS = 365

/** A report that cannot be filed: the target is not on that project, or too many reports. */
export class ReportRefused extends HttpApiError.Problem<ReportRefused>()("ReportRefused", {
  type: "https://re-hydra.dev/problems/report-refused",
  status: 400,
  title: "Report not accepted"
}) {}

/** The admin action does not apply: already archived, or an admin's own account. */
export class ModerationRefused extends HttpApiError.Problem<ModerationRefused>()("ModerationRefused", {
  type: "https://re-hydra.dev/problems/moderation-refused",
  status: 409,
  title: "Action not possible"
}) {}

export const ReportReason = Schema.Literals(["copyright", "malware", "abuse", "other"]).annotate({
  identifier: "ReportReason"
})
export type ReportReason = typeof ReportReason.Type

/** Free text for a report, a resolution, or the reason recorded with an action. */
export const ModerationText = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(2000))

export const CreateReportPayload = Schema.Struct({
  projectSlug: Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(100)),
  chunkId: Schema.optionalKey(Uuid),
  postId: Schema.optionalKey(Uuid),
  reason: ReportReason,
  body: ModerationText
}).annotate({ identifier: "CreateReportPayload" })
export type CreateReportPayload = typeof CreateReportPayload.Type

export const ReportCreated = Schema.Struct({ id: Uuid }).annotate({ identifier: "ReportCreated" })

const PersonRef = Schema.Struct({ id: Uuid, displayName: Schema.String })

export const AdminReport = Schema.Struct({
  id: Uuid,
  reason: ReportReason,
  body: Schema.String,
  createdAt: Schema.String,
  reporter: Schema.NullOr(PersonRef),
  project: Schema.Struct({ id: Uuid, slug: Schema.String, name: Schema.String, archived: Schema.Boolean }),
  chunk: Schema.NullOr(Schema.Struct({ id: Uuid, name: Schema.String })),
  post: Schema.NullOr(Schema.Struct({
    id: Uuid,
    threadId: Uuid,
    /** The start of the post, or empty once it was removed. */
    excerpt: Schema.String,
    removed: Schema.Boolean,
    author: Schema.NullOr(PersonRef)
  })),
  resolvedAt: Schema.NullOr(Schema.String),
  resolution: Schema.NullOr(Schema.String),
  resolvedBy: Schema.NullOr(PersonRef)
}).annotate({ identifier: "AdminReport" })
export type AdminReport = typeof AdminReport.Type

export const ModerationNote = Schema.Struct({ note: ModerationText }).annotate({ identifier: "ModerationNote" })
export type ModerationNote = typeof ModerationNote.Type

export const ResolveReportPayload = Schema.Struct({ resolution: ModerationText }).annotate({
  identifier: "ResolveReportPayload"
})

export const AdminUser = Schema.Struct({
  id: Uuid,
  email: Schema.String,
  displayName: Schema.String,
  isAdmin: Schema.Boolean,
  suspendedAt: Schema.NullOr(Schema.String),
  suspendedReason: Schema.NullOr(Schema.String),
  /** Strikes not reversed and younger than STRIKE_WINDOW_DAYS. */
  activeStrikes: Schema.Int,
  /** activeStrikes has reached STRIKE_LIMIT: the policy says close the account. */
  atStrikeLimit: Schema.Boolean,
  createdAt: Schema.String
}).annotate({ identifier: "AdminUser" })

export const Strike = Schema.Struct({
  id: Uuid,
  user: PersonRef,
  admin: Schema.NullOr(PersonRef),
  note: Schema.String,
  createdAt: Schema.String,
  reversedAt: Schema.NullOr(Schema.String),
  reversedBy: Schema.NullOr(PersonRef),
  reversalNote: Schema.NullOr(Schema.String),
  /** Counts toward the limit: not reversed and inside the window. */
  active: Schema.Boolean
}).annotate({ identifier: "Strike" })
export type Strike = typeof Strike.Type
export type AdminUser = typeof AdminUser.Type

export const AdminProject = Schema.Struct({
  id: Uuid,
  slug: Schema.String,
  name: Schema.String,
  ownerName: Schema.NullOr(Schema.String),
  archivedAt: Schema.NullOr(Schema.String),
  openReports: Schema.Int,
  createdAt: Schema.String
}).annotate({ identifier: "AdminProject" })
export type AdminProject = typeof AdminProject.Type

export const ModerationActionKind = Schema.Literals([
  "archive_project",
  "restore_project",
  "remove_post",
  "suspend_user",
  "restore_user",
  "resolve_report",
  "grant_admin",
  "revoke_admin",
  "add_strike",
  "reverse_strike",
  "allow_malware_hash",
  "confirm_malware_hit"
])

export const ModerationAction = Schema.Struct({
  id: Uuid,
  kind: ModerationActionKind,
  admin: Schema.NullOr(PersonRef),
  project: Schema.NullOr(Schema.Struct({ id: Uuid, slug: Schema.String, name: Schema.String })),
  user: Schema.NullOr(PersonRef),
  postId: Schema.NullOr(Uuid),
  reportId: Schema.NullOr(Uuid),
  note: Schema.String,
  createdAt: Schema.String
}).annotate({ identifier: "ModerationAction" })
export type ModerationAction = typeof ModerationAction.Type

/**
 * Content policy 4.3: a program whose SHA-256 is on the known-malware list.
 * `import`: an import was refused. `existing`: a program already on the site
 * turned up on a later list.
 */
export const MalwareHitKind = Schema.Literals(["import", "existing"])
export const MalwareResolution = Schema.Literals(["allowed", "confirmed"])

export const MalwareHit = Schema.Struct({
  id: Uuid,
  kind: MalwareHitKind,
  sha256: Schema.String,
  programName: Schema.NullOr(Schema.String),
  user: Schema.NullOr(PersonRef),
  project: Schema.NullOr(Schema.Struct({
    id: Uuid,
    slug: Schema.String,
    name: Schema.String,
    archivedAt: Schema.NullOr(Schema.String)
  })),
  createdAt: Schema.String,
  resolvedAt: Schema.NullOr(Schema.String),
  resolvedBy: Schema.NullOr(PersonRef),
  resolution: Schema.NullOr(MalwareResolution),
  resolutionNote: Schema.NullOr(Schema.String)
}).annotate({ identifier: "MalwareHit" })
export type MalwareHit = typeof MalwareHit.Type

export const MalwareListStatus = Schema.Struct({
  /** A list URL is configured (MALWARE_HASHLIST_URL); without one, nothing new is downloaded. */
  configured: Schema.Boolean,
  hashCount: Schema.Int,
  allowedCount: Schema.Int,
  refreshedAt: Schema.NullOr(Schema.String),
  lastAttemptAt: Schema.NullOr(Schema.String),
  lastError: Schema.NullOr(Schema.String)
}).annotate({ identifier: "MalwareListStatus" })
export type MalwareListStatus = typeof MalwareListStatus.Type

export const MalwareOverview = Schema.Struct({
  list: MalwareListStatus,
  hits: Schema.Array(MalwareHit)
}).annotate({ identifier: "MalwareOverview" })
export type MalwareOverview = typeof MalwareOverview.Type

export const ResolveMalwareHitPayload = Schema.Struct({
  /** allowed: a false positive, the hash is never matched again. confirmed: it is malware. */
  resolution: MalwareResolution,
  note: ModerationText
}).annotate({ identifier: "ResolveMalwareHitPayload" })
export type ResolveMalwareHitPayload = typeof ResolveMalwareHitPayload.Type
