import { Context, Effect, Layer } from "effect"
import { Forbidden, NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import type { MarkUnresolvedPayload, UnresolvedType } from "../domain/Types.js"
import { ProjectRefused } from "../domain/Problems.js"
import { Uuid } from "../domain/Uuid.js"
import { Activity } from "./Activity.js"
import { ProjectAuth } from "./ProjectAuth.js"
import { ProjectChunkStats } from "./ProjectChunkStats.js"

type Row = {
  readonly id: string
  readonly project_id: string
  readonly type_name: string
  readonly reason: string
  readonly created_by: string | null
  readonly created_at: Date | string
  readonly cleared_at: Date | string | null
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const toUnresolved = (row: Row): UnresolvedType => ({
  id: row.id,
  projectId: row.project_id,
  typeName: row.type_name,
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: toIso(row.created_at),
  ...(row.cleared_at !== null ? { clearedAt: toIso(row.cleared_at) } : {})
})

export class UnresolvedTypesRepo extends Context.Service<
  UnresolvedTypesRepo,
  {
    readonly listActive: (
      projectSlug: string
    ) => Effect.Effect<ReadonlyArray<UnresolvedType>, NotFound>
    readonly mark: (
      projectSlug: string,
      userId: Uuid,
      payload: MarkUnresolvedPayload
    ) => Effect.Effect<UnresolvedType, NotFound | Forbidden | ProjectRefused>
    readonly clear: (
      projectSlug: string,
      typeName: string,
      userId: Uuid
    ) => Effect.Effect<UnresolvedType, NotFound | Forbidden | ProjectRefused>
  }
>()("rehydra/services/UnresolvedTypesRepo") {
  static readonly layer = Layer.effect(
    UnresolvedTypesRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const auth = yield* ProjectAuth
      const stats = yield* ProjectChunkStats
      const activity = yield* Activity

      const listActive = Effect.fn("UnresolvedTypesRepo.listActive")(
        function*(projectSlug: string) {
          const projects = yield* sql<{ readonly id: string }>`
            SELECT id FROM projects
            WHERE slug = ${projectSlug} AND archived_at IS NULL
            LIMIT 1
          `.pipe(Effect.orDie)
          if (projects[0] === undefined) {
            return yield* new NotFound()
          }
          const rows = yield* sql<Row>`
            SELECT * FROM unresolved_types
            WHERE project_id = ${projects[0].id}
              AND cleared_at IS NULL
            ORDER BY type_name
          `.pipe(Effect.orDie)
          return rows.map(toUnresolved)
        }
      )

      const mark = Effect.fn("UnresolvedTypesRepo.mark")(function*(
        projectSlug: string,
        userId: Uuid,
        payload: MarkUnresolvedPayload
      ) {
        const { projectId } = yield* auth.requireRole(projectSlug, userId, [
          "owner",
          "maintainer"
        ])

        return yield* sql.withTransaction(Effect.gen(function*() {
          const existing = yield* sql<Row>`
            SELECT * FROM unresolved_types
            WHERE project_id = ${projectId}
              AND type_name = ${payload.typeName.trim()}
              AND cleared_at IS NULL
            LIMIT 1
          `
          if (existing[0] !== undefined) {
            return yield* new ProjectRefused({
              reason: "already_marked",
              detail: `${payload.typeName.trim()} is already marked unresolved.`
            })
          }

          const inserted = yield* sql<Row>`
            INSERT INTO unresolved_types (
              project_id, type_name, reason, created_by
            ) VALUES (
              ${projectId},
              ${payload.typeName.trim()},
              ${payload.reason ?? ""},
              ${userId}
            )
            RETURNING *
          `
          const row = inserted[0]
          if (row === undefined) {
            return yield* Effect.die("INSERT INTO unresolved_types returned no row")
          }

          yield* sql`
            UPDATE chunks c
            SET
              state = 'blocked',
              lease_user_id = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              hold_started_at = NULL,
              updated_at = now()
            FROM chunk_type_refs ctr
            WHERE ctr.chunk_id = c.id
              AND ctr.type_name = ${payload.typeName.trim()}
              AND c.project_id = ${projectId}
              AND c.fuse_parent_id IS NULL
              AND c.state IN ('open', 'stale')
          `

          yield* stats.refresh(projectId)
          yield* activity.record({
            projectId,
            actorId: userId,
            kind: "unresolved_marked",
            subjectId: row.id,
            summary: `Marked ${row.type_name} unresolved`
          })
          return toUnresolved(row)
        })).pipe(Effect.catchTag("SqlError", (e) => Effect.die(e)))
      })

      const clear = Effect.fn("UnresolvedTypesRepo.clear")(function*(
        projectSlug: string,
        typeName: string,
        userId: Uuid
      ) {
        const { projectId } = yield* auth.requireRole(projectSlug, userId, [
          "owner",
          "maintainer"
        ])

        return yield* sql.withTransaction(Effect.gen(function*() {
          const updated = yield* sql<Row>`
            UPDATE unresolved_types
            SET cleared_at = now(), cleared_by = ${userId}
            WHERE project_id = ${projectId}
              AND type_name = ${typeName}
              AND cleared_at IS NULL
            RETURNING *
          `
          const row = updated[0]
          if (row === undefined) {
            return yield* new NotFound()
          }

          // Still blocked by another unresolved type?
          yield* sql`
            UPDATE chunks c
            SET
              state = CASE
                WHEN c.current_match_id IS NULL AND EXISTS (
                  SELECT 1 FROM matches m
                  WHERE m.chunk_id = c.id AND m.invalidated_at IS NOT NULL
                ) THEN 'stale'::chunk_state
                ELSE 'open'::chunk_state
              END,
              updated_at = now()
            WHERE c.project_id = ${projectId}
              AND c.state = 'blocked'
              AND c.fuse_parent_id IS NULL
              AND EXISTS (
                SELECT 1 FROM chunk_type_refs ctr
                WHERE ctr.chunk_id = c.id AND ctr.type_name = ${typeName}
              )
              AND NOT EXISTS (
                SELECT 1
                FROM chunk_type_refs ctr2
                INNER JOIN unresolved_types ut
                  ON ut.project_id = c.project_id
                 AND ut.type_name = ctr2.type_name
                 AND ut.cleared_at IS NULL
                WHERE ctr2.chunk_id = c.id
              )
          `

          yield* stats.refresh(projectId)
          yield* activity.record({
            projectId,
            actorId: userId,
            kind: "unresolved_cleared",
            subjectId: row.id,
            summary: `Cleared unresolved mark on ${row.type_name}`
          })

          return toUnresolved(row)
        })).pipe(Effect.catchTag("SqlError", (e) => Effect.die(e)))
      })

      return UnresolvedTypesRepo.of({ listActive, mark, clear })
    })
  )
}
