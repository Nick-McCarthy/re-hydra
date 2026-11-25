import { Context, Effect, Layer } from "effect"
import { NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import {
  type AdminProject,
  type AdminReport,
  type AdminUser,
  type CreateReportPayload,
  type ModerationAction,
  ModerationRefused,
  ReportRefused
} from "../domain/Moderation.js"
import type { Uuid } from "../domain/Uuid.js"
import { RateLimits } from "./RateLimits.js"

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()
const isoOrNull = (value: Date | string | null): string | null => (value === null ? null : toIso(value))
const person = (id: string | null, name: string | null) =>
  id === null || name === null ? null : { id, displayName: name }

/** Reports from any signed-in user, at most this many an hour. */
const REPORTS_PER_HOUR = 10

type ActionKind = ModerationAction["kind"]

/**
 * The content policy's enforcement side: reports from users, and what a site
 * admin can do about them. Every admin action is written to
 * `moderation_actions` with the admin's note, in the same transaction as the
 * change, so the record of a takedown cannot drift from what happened.
 */
export class Moderation extends Context.Service<
  Moderation,
  {
    readonly report: (
      reporterId: Uuid,
      payload: CreateReportPayload
    ) => Effect.Effect<{ readonly id: Uuid }, NotFound | ReportRefused>
    readonly listReports: (status: "open" | "resolved") => Effect.Effect<ReadonlyArray<AdminReport>>
    readonly resolveReport: (
      adminId: Uuid,
      reportId: Uuid,
      resolution: string
    ) => Effect.Effect<AdminReport, NotFound | ModerationRefused>
    readonly searchProjects: (q: string) => Effect.Effect<ReadonlyArray<AdminProject>>
    readonly archiveProject: (adminId: Uuid, slug: string, note: string) => Effect.Effect<AdminProject, NotFound | ModerationRefused>
    readonly restoreProject: (adminId: Uuid, slug: string, note: string) => Effect.Effect<AdminProject, NotFound | ModerationRefused>
    readonly removePost: (adminId: Uuid, postId: Uuid, note: string) => Effect.Effect<void, NotFound | ModerationRefused>
    readonly searchUsers: (q: string) => Effect.Effect<ReadonlyArray<AdminUser>>
    readonly suspendUser: (adminId: Uuid, userId: Uuid, note: string) => Effect.Effect<AdminUser, NotFound | ModerationRefused>
    readonly restoreUser: (adminId: Uuid, userId: Uuid, note: string) => Effect.Effect<AdminUser, NotFound | ModerationRefused>
    readonly listActions: (limit: number) => Effect.Effect<ReadonlyArray<ModerationAction>>
  }
>()("rehydra/services/Moderation") {
  static readonly layer = Layer.effect(
    Moderation,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const limits = yield* RateLimits

      const record = (
        adminId: Uuid,
        kind: ActionKind,
        note: string,
        refs: { projectId?: string; userId?: string; postId?: string; reportId?: string }
      ) =>
        sql`
          INSERT INTO moderation_actions (admin_id, kind, project_id, user_id, post_id, report_id, note)
          VALUES (${adminId}, ${kind}, ${refs.projectId ?? null}, ${refs.userId ?? null},
                  ${refs.postId ?? null}, ${refs.reportId ?? null}, ${note})
        `

      // --- Reports -----------------------------------------------------------

      const report = Effect.fn("Moderation.report")(function*(reporterId: Uuid, payload: CreateReportPayload) {
        const taken = limits.take(`report:${reporterId}`, REPORTS_PER_HOUR, 60 * 60_000)
        if (!taken.ok) {
          return yield* new ReportRefused({
            detail: `You have sent ${REPORTS_PER_HOUR} reports in the last hour. Try again in ${Math.ceil(taken.retryAfterSeconds / 60)} minutes.`
          })
        }
        const projects = yield* sql<{ readonly id: string }>`
          SELECT id FROM projects WHERE slug = ${payload.projectSlug} AND archived_at IS NULL LIMIT 1
        `.pipe(Effect.orDie)
        const project = projects[0]
        if (project === undefined) return yield* new NotFound()
        if (payload.chunkId !== undefined) {
          const found = yield* sql`
            SELECT 1 FROM chunks WHERE id = ${payload.chunkId} AND project_id = ${project.id}
          `.pipe(Effect.orDie)
          if (found.length === 0) return yield* new ReportRefused({ detail: "That function is not part of this project." })
        }
        if (payload.postId !== undefined) {
          const found = yield* sql`
            SELECT 1 FROM project_posts p
            INNER JOIN project_threads t ON t.id = p.thread_id
            WHERE p.id = ${payload.postId} AND t.project_id = ${project.id}
          `.pipe(Effect.orDie)
          if (found.length === 0) return yield* new ReportRefused({ detail: "That post is not part of this project." })
        }
        const body = payload.body.trim()
        if (body.length === 0) return yield* new ReportRefused({ detail: "Say what is wrong." })
        const rows = yield* sql<{ readonly id: Uuid }>`
          INSERT INTO reports (reporter_id, project_id, chunk_id, post_id, reason, body)
          VALUES (${reporterId}, ${project.id}, ${payload.chunkId ?? null}, ${payload.postId ?? null},
                  ${payload.reason}, ${body})
          RETURNING id
        `.pipe(Effect.orDie)
        return { id: rows[0]!.id }
      })

      type ReportRow = {
        readonly id: Uuid
        readonly reason: AdminReport["reason"]
        readonly body: string
        readonly created_at: Date | string
        readonly reporter_id: string | null
        readonly reporter_name: string | null
        readonly project_id: Uuid
        readonly project_slug: string
        readonly project_name: string
        readonly project_archived: boolean
        readonly chunk_id: Uuid | null
        readonly chunk_name: string | null
        readonly post_id: Uuid | null
        readonly thread_id: Uuid | null
        readonly post_body: string | null
        readonly post_deleted: boolean | null
        readonly post_author_id: string | null
        readonly post_author_name: string | null
        readonly resolved_at: Date | string | null
        readonly resolution: string | null
        readonly resolver_id: string | null
        readonly resolver_name: string | null
      }

      const toReport = (row: ReportRow): AdminReport => ({
        id: row.id,
        reason: row.reason,
        body: row.body,
        createdAt: toIso(row.created_at),
        reporter: person(row.reporter_id, row.reporter_name),
        project: { id: row.project_id, slug: row.project_slug, name: row.project_name, archived: row.project_archived },
        chunk: row.chunk_id === null || row.chunk_name === null ? null : { id: row.chunk_id, name: row.chunk_name },
        post: row.post_id === null || row.thread_id === null
          ? null
          : {
            id: row.post_id,
            threadId: row.thread_id,
            excerpt: row.post_deleted === true ? "" : (row.post_body ?? "").slice(0, 280),
            removed: row.post_deleted === true,
            author: person(row.post_author_id, row.post_author_name)
          },
        resolvedAt: isoOrNull(row.resolved_at),
        resolution: row.resolution,
        resolvedBy: person(row.resolver_id, row.resolver_name)
      })

      const reportSelect = sql`
        SELECT
          r.id, r.reason, r.body, r.created_at,
          reporter.id AS reporter_id, reporter.display_name AS reporter_name,
          p.id AS project_id, p.slug AS project_slug, p.name AS project_name,
          (p.archived_at IS NOT NULL) AS project_archived,
          c.id AS chunk_id, c.name AS chunk_name,
          post.id AS post_id, post.thread_id, post.body AS post_body,
          (post.deleted_at IS NOT NULL) AS post_deleted,
          author.id AS post_author_id, author.display_name AS post_author_name,
          r.resolved_at, r.resolution,
          resolver.id AS resolver_id, resolver.display_name AS resolver_name
        FROM reports r
        INNER JOIN projects p ON p.id = r.project_id
        LEFT JOIN users reporter ON reporter.id = r.reporter_id
        LEFT JOIN chunks c ON c.id = r.chunk_id
        LEFT JOIN project_posts post ON post.id = r.post_id
        LEFT JOIN users author ON author.id = post.author_id
        LEFT JOIN users resolver ON resolver.id = r.resolved_by
      `

      const listReports = Effect.fn("Moderation.listReports")(function*(status: "open" | "resolved") {
        const rows = status === "open"
          ? yield* sql<ReportRow>`${reportSelect} WHERE r.resolved_at IS NULL ORDER BY r.created_at ASC LIMIT 200`
          : yield* sql<ReportRow>`${reportSelect} WHERE r.resolved_at IS NOT NULL ORDER BY r.resolved_at DESC LIMIT 200`
        return rows.map(toReport)
      }, Effect.orDie)

      const getReport = (reportId: Uuid) =>
        sql<ReportRow>`${reportSelect} WHERE r.id = ${reportId}`.pipe(
          Effect.map((rows) => rows[0]),
          Effect.orDie
        )

      const resolveReport = Effect.fn("Moderation.resolveReport")(function*(
        adminId: Uuid,
        reportId: Uuid,
        resolution: string
      ) {
        const text = resolution.trim()
        if (text.length === 0) return yield* new ModerationRefused({ detail: "Say how the report was handled." })
        const updated = yield* sql.withTransaction(Effect.gen(function*() {
          const rows = yield* sql<{ readonly project_id: string }>`
            UPDATE reports
            SET resolved_at = now(), resolved_by = ${adminId}, resolution = ${text}
            WHERE id = ${reportId} AND resolved_at IS NULL
            RETURNING project_id
          `
          if (rows[0] === undefined) return false
          yield* record(adminId, "resolve_report", text, { reportId, projectId: rows[0].project_id })
          return true
        })).pipe(Effect.orDie)
        const row = yield* getReport(reportId)
        if (row === undefined) return yield* new NotFound()
        if (!updated) return yield* new ModerationRefused({ detail: "This report is already resolved." })
        return toReport(row)
      })

      // --- Projects ----------------------------------------------------------

      type ProjectRow = {
        readonly id: Uuid
        readonly slug: string
        readonly name: string
        readonly owner_name: string | null
        readonly archived_at: Date | string | null
        readonly open_reports: number | string
        readonly created_at: Date | string
      }
      const toProject = (row: ProjectRow): AdminProject => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        ownerName: row.owner_name,
        archivedAt: isoOrNull(row.archived_at),
        openReports: Number(row.open_reports),
        createdAt: toIso(row.created_at)
      })
      const projectSelect = sql`
        SELECT
          p.id, p.slug, p.name, p.archived_at, p.created_at,
          (
            SELECT u.display_name FROM project_members m
            INNER JOIN users u ON u.id = m.user_id
            WHERE m.project_id = p.id AND m.role = 'owner'
            LIMIT 1
          ) AS owner_name,
          (SELECT count(*) FROM reports r WHERE r.project_id = p.id AND r.resolved_at IS NULL) AS open_reports
        FROM projects p
      `

      const searchProjects = Effect.fn("Moderation.searchProjects")(function*(q: string) {
        const term = `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
        const rows = yield* sql<ProjectRow>`
          ${projectSelect}
          WHERE p.slug ILIKE ${term} OR p.name ILIKE ${term}
          ORDER BY p.archived_at DESC NULLS LAST, p.created_at DESC
          LIMIT 50
        `
        return rows.map(toProject)
      }, Effect.orDie)

      const projectBySlug = (slug: string) =>
        sql<ProjectRow>`${projectSelect} WHERE p.slug = ${slug} LIMIT 1`.pipe(
          Effect.map((rows) => rows[0]),
          Effect.orDie
        )

      const setArchived = (archive: boolean) =>
        Effect.fn(archive ? "Moderation.archiveProject" : "Moderation.restoreProject")(function*(
          adminId: Uuid,
          slug: string,
          note: string
        ) {
          if (note.trim().length === 0) return yield* new ModerationRefused({ detail: "Write a note saying why." })
          const before = yield* projectBySlug(slug)
          if (before === undefined) return yield* new NotFound()
          if ((before.archived_at !== null) === archive) {
            return yield* new ModerationRefused({
              detail: archive ? "This project is already archived." : "This project is not archived."
            })
          }
          yield* sql.withTransaction(Effect.gen(function*() {
            if (archive) {
              yield* sql`UPDATE projects SET archived_at = now() WHERE id = ${before.id}`
            } else {
              yield* sql`UPDATE projects SET archived_at = NULL WHERE id = ${before.id}`
            }
            yield* record(adminId, archive ? "archive_project" : "restore_project", note.trim(), { projectId: before.id })
          })).pipe(Effect.orDie)
          const after = yield* projectBySlug(slug)
          return toProject(after ?? before)
        })

      // --- Posts -------------------------------------------------------------

      const removePost = Effect.fn("Moderation.removePost")(function*(adminId: Uuid, postId: Uuid, note: string) {
        if (note.trim().length === 0) return yield* new ModerationRefused({ detail: "Write a note saying why." })
        const rows = yield* sql<{ readonly project_id: string; readonly deleted: boolean }>`
          SELECT t.project_id, (p.deleted_at IS NOT NULL) AS deleted
          FROM project_posts p
          INNER JOIN project_threads t ON t.id = p.thread_id
          WHERE p.id = ${postId}
        `.pipe(Effect.orDie)
        const row = rows[0]
        if (row === undefined) return yield* new NotFound()
        if (row.deleted) return yield* new ModerationRefused({ detail: "This post is already removed." })
        yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`UPDATE project_posts SET deleted_at = now(), deleted_by = ${adminId} WHERE id = ${postId}`
          yield* record(adminId, "remove_post", note.trim(), { postId, projectId: row.project_id })
        })).pipe(Effect.orDie)
      })

      // --- Users -------------------------------------------------------------

      type UserRow = {
        readonly id: Uuid
        readonly email: string
        readonly display_name: string
        readonly is_admin: boolean
        readonly suspended_at: Date | string | null
        readonly suspended_reason: string | null
        readonly created_at: Date | string
      }
      const toUser = (row: UserRow): AdminUser => ({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        isAdmin: row.is_admin,
        suspendedAt: isoOrNull(row.suspended_at),
        suspendedReason: row.suspended_reason,
        createdAt: toIso(row.created_at)
      })
      const userSelect = sql`
        SELECT id, email, display_name, is_admin, suspended_at, suspended_reason, created_at FROM users
      `

      const searchUsers = Effect.fn("Moderation.searchUsers")(function*(q: string) {
        const term = `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
        const rows = yield* sql<UserRow>`
          ${userSelect}
          WHERE email ILIKE ${term} OR display_name ILIKE ${term}
          ORDER BY suspended_at DESC NULLS LAST, created_at DESC
          LIMIT 50
        `
        return rows.map(toUser)
      }, Effect.orDie)

      const userById = (userId: Uuid) =>
        sql<UserRow>`${userSelect} WHERE id = ${userId}`.pipe(
          Effect.map((rows) => rows[0]),
          Effect.orDie
        )

      const suspendUser = Effect.fn("Moderation.suspendUser")(function*(adminId: Uuid, userId: Uuid, note: string) {
        if (note.trim().length === 0) return yield* new ModerationRefused({ detail: "Write a note saying why." })
        const before = yield* userById(userId)
        if (before === undefined) return yield* new NotFound()
        if (userId === adminId) return yield* new ModerationRefused({ detail: "You cannot suspend your own account." })
        if (before.is_admin) {
          return yield* new ModerationRefused({ detail: "Revoke admin from this account before suspending it." })
        }
        if (before.suspended_at !== null) return yield* new ModerationRefused({ detail: "This account is already suspended." })
        const reason = note.trim()
        yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`UPDATE users SET suspended_at = now(), suspended_reason = ${reason} WHERE id = ${userId}`
          // Signed out everywhere: sessions and access tokens stop working now.
          yield* sql`UPDATE sessions SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`
          yield* sql`UPDATE access_tokens SET revoked_at = now() WHERE user_id = ${userId} AND revoked_at IS NULL`
          yield* record(adminId, "suspend_user", reason, { userId })
        })).pipe(Effect.orDie)
        return toUser((yield* userById(userId)) ?? before)
      })

      const restoreUser = Effect.fn("Moderation.restoreUser")(function*(adminId: Uuid, userId: Uuid, note: string) {
        if (note.trim().length === 0) return yield* new ModerationRefused({ detail: "Write a note saying why." })
        const before = yield* userById(userId)
        if (before === undefined) return yield* new NotFound()
        if (before.suspended_at === null) return yield* new ModerationRefused({ detail: "This account is not suspended." })
        yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = ${userId}`
          yield* record(adminId, "restore_user", note.trim(), { userId })
        })).pipe(Effect.orDie)
        return toUser((yield* userById(userId)) ?? before)
      })

      // --- The record ----------------------------------------------------------

      const listActions = Effect.fn("Moderation.listActions")(function*(limit: number) {
        const rows = yield* sql<{
          readonly id: Uuid
          readonly kind: ActionKind
          readonly admin_id: string | null
          readonly admin_name: string | null
          readonly project_id: Uuid | null
          readonly project_slug: string | null
          readonly project_name: string | null
          readonly user_id: string | null
          readonly user_name: string | null
          readonly post_id: Uuid | null
          readonly report_id: Uuid | null
          readonly note: string
          readonly created_at: Date | string
        }>`
          SELECT
            a.id, a.kind, a.note, a.created_at, a.post_id, a.report_id,
            admin.id AS admin_id, admin.display_name AS admin_name,
            p.id AS project_id, p.slug AS project_slug, p.name AS project_name,
            u.id AS user_id, u.display_name AS user_name
          FROM moderation_actions a
          LEFT JOIN users admin ON admin.id = a.admin_id
          LEFT JOIN projects p ON p.id = a.project_id
          LEFT JOIN users u ON u.id = a.user_id
          ORDER BY a.created_at DESC
          LIMIT ${limit}
        `
        return rows.map((row): ModerationAction => ({
          id: row.id,
          kind: row.kind,
          admin: person(row.admin_id, row.admin_name),
          project: row.project_id === null || row.project_slug === null || row.project_name === null
            ? null
            : { id: row.project_id, slug: row.project_slug, name: row.project_name },
          user: person(row.user_id, row.user_name),
          postId: row.post_id,
          reportId: row.report_id,
          note: row.note,
          createdAt: toIso(row.created_at)
        }))
      }, Effect.orDie)

      return Moderation.of({
        report,
        listReports,
        resolveReport,
        searchProjects,
        archiveProject: setArchived(true),
        restoreProject: setArchived(false),
        removePost,
        searchUsers,
        suspendUser,
        restoreUser,
        listActions
      })
    })
  )
}
