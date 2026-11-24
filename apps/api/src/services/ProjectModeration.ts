import { Context, Effect, Layer } from "effect"
import { Forbidden, NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import { type BlockedUser, type BlockUserPayload, ProjectAccessDenied } from "../domain/Project.js"
import type { Uuid } from "../domain/Uuid.js"
import { Activity } from "./Activity.js"
import { endUserLeasesOnProject } from "./PoolReturn.js"
import { ProjectAuth } from "./ProjectAuth.js"
import { ProjectChunkStats } from "./ProjectChunkStats.js"

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

/**
 * Audit A-012. Owners and maintainers block users from one project. A
 * blocked user cannot check out, heartbeat, submit, or propose types there
 * (ProjectAuth.requireContributor), and their current leases on the project
 * are cleared when the block is placed.
 *
 * The public activity feed records that a block happened, without the name,
 * so the feed cannot be used to single anyone out. Owners and maintainers see
 * names in the block list.
 *
 * Owners and maintainers cannot be blocked; demote them first (A-011).
 * Blocking a contributor also removes them from the project, and cancels any
 * ownership offer made to them, so the member and block lists never disagree.
 */
export class ProjectModeration extends Context.Service<
  ProjectModeration,
  {
    readonly listBlocks: (
      projectSlug: string,
      userId: Uuid
    ) => Effect.Effect<ReadonlyArray<BlockedUser>, NotFound | Forbidden>
    readonly block: (
      projectSlug: string,
      userId: Uuid,
      payload: BlockUserPayload
    ) => Effect.Effect<ReadonlyArray<BlockedUser>, NotFound | Forbidden | ProjectAccessDenied>
    readonly unblock: (
      projectSlug: string,
      userId: Uuid,
      targetId: Uuid
    ) => Effect.Effect<ReadonlyArray<BlockedUser>, NotFound | Forbidden>
  }
>()("rehydra/services/ProjectModeration") {
  static readonly layer = Layer.effect(
    ProjectModeration,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const auth = yield* ProjectAuth
      const activity = yield* Activity
      const stats = yield* ProjectChunkStats

      const loadBlocks = (projectId: string) =>
        sql<{
          readonly user_id: string
          readonly display_name: string
          readonly blocked_by: string
          readonly blocked_by_name: string
          readonly reason: string
          readonly created_at: Date | string
        }>`
          SELECT b.user_id, u.display_name, b.blocked_by, bu.display_name AS blocked_by_name, b.reason, b.created_at
          FROM project_blocks b
          INNER JOIN users u ON u.id = b.user_id
          INNER JOIN users bu ON bu.id = b.blocked_by
          WHERE b.project_id = ${projectId}
          ORDER BY b.created_at DESC
        `.pipe(
          Effect.orDie,
          Effect.map((rows) =>
            rows.map((row): BlockedUser => ({
              userId: row.user_id as Uuid,
              displayName: row.display_name,
              blockedBy: row.blocked_by as Uuid,
              blockedByName: row.blocked_by_name,
              reason: row.reason,
              createdAt: toIso(row.created_at)
            }))
          )
        )

      const listBlocks = Effect.fn("ProjectModeration.listBlocks")(function*(projectSlug: string, userId: Uuid) {
        const { projectId } = yield* auth.requireRole(projectSlug, userId, ["owner", "maintainer"])
        return yield* loadBlocks(projectId)
      })

      const block = Effect.fn("ProjectModeration.block")(function*(
        projectSlug: string,
        userId: Uuid,
        payload: BlockUserPayload
      ) {
        const { projectId } = yield* auth.requireRole(projectSlug, userId, ["owner", "maintainer"])
        if (payload.userId === userId) {
          return yield* new ProjectAccessDenied({ detail: "You cannot block yourself." })
        }
        const targets = yield* sql<{ readonly id: string; readonly role: string | null }>`
          SELECT u.id, pm.role
          FROM users u
          LEFT JOIN project_members pm ON pm.project_id = ${projectId} AND pm.user_id = u.id
          WHERE u.id = ${payload.userId}
          LIMIT 1
        `.pipe(Effect.orDie)
        const target = targets[0]
        if (target === undefined) return yield* new NotFound()
        if (target.role === "owner" || target.role === "maintainer") {
          return yield* new ProjectAccessDenied({ detail: "Owners and maintainers cannot be blocked. Demote them to contributor first." })
        }

        yield* sql.withTransaction(Effect.gen(function*() {
          const inserted = yield* sql<{ readonly user_id: string }>`
            INSERT INTO project_blocks (project_id, user_id, blocked_by, reason)
            VALUES (${projectId}, ${payload.userId}, ${userId}, ${payload.reason ?? ""})
            ON CONFLICT (project_id, user_id) DO UPDATE SET reason = EXCLUDED.reason
            RETURNING user_id
          `
          // Their leases here end now, as a maintainer's "clear lease" would.
          yield* endUserLeasesOnProject(sql, activity.releaseSideLeases, projectId, payload.userId)
          // A-011: a blocked contributor stops being a member, and loses any
          // pending ownership offer. Owners and maintainers were refused above.
          yield* sql`
            DELETE FROM project_members
            WHERE project_id = ${projectId} AND user_id = ${payload.userId} AND role = 'contributor'
          `
          yield* sql`
            UPDATE ownership_transfers
            SET state = 'cancelled', resolved_at = now()
            WHERE project_id = ${projectId} AND offered_to = ${payload.userId} AND state = 'open'
          `
          if (inserted[0] !== undefined) {
            yield* activity.record({
              projectId,
              actorId: userId,
              kind: "settings_changed",
              summary: "A user was blocked from this project"
            })
          }
          yield* stats.refresh(projectId)
        })).pipe(Effect.orDie)

        return yield* loadBlocks(projectId)
      })

      const unblock = Effect.fn("ProjectModeration.unblock")(function*(
        projectSlug: string,
        userId: Uuid,
        targetId: Uuid
      ) {
        const { projectId } = yield* auth.requireRole(projectSlug, userId, ["owner", "maintainer"])
        const removed = yield* sql<{ readonly user_id: string }>`
          DELETE FROM project_blocks
          WHERE project_id = ${projectId} AND user_id = ${targetId}
          RETURNING user_id
        `.pipe(Effect.orDie)
        if (removed[0] === undefined) return yield* new NotFound()
        yield* activity.record({
          projectId,
          actorId: userId,
          kind: "settings_changed",
          summary: "A block on this project was lifted"
        })
        return yield* loadBlocks(projectId)
      })

      return ProjectModeration.of({ listBlocks, block, unblock })
    })
  )
}
