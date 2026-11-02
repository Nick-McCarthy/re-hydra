import { Context, Effect, Layer } from "effect"
import { Forbidden, NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import { Uuid } from "../domain/Uuid.js"

export type MemberRole = "owner" | "maintainer" | "contributor"

export class ProjectAuth extends Context.Service<
  ProjectAuth,
  {
    readonly requireRole: (
      projectSlug: string,
      userId: Uuid,
      allowed: ReadonlyArray<MemberRole>
    ) => Effect.Effect<{ readonly projectId: string; readonly role: MemberRole }, NotFound | Forbidden>
  }
>()("rehydra/services/ProjectAuth") {
  static readonly layer = Layer.effect(
    ProjectAuth,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient

      const requireRole = Effect.fn("ProjectAuth.requireRole")(
        function*(
          projectSlug: string,
          userId: Uuid,
          allowed: ReadonlyArray<MemberRole>
        ) {
          const rows = yield* sql<{
            readonly project_id: string
            readonly role: MemberRole
          }>`
            SELECT p.id AS project_id, pm.role
            FROM projects p
            INNER JOIN project_members pm
              ON pm.project_id = p.id AND pm.user_id = ${userId}
            WHERE p.slug = ${projectSlug}
              AND p.archived_at IS NULL
            LIMIT 1
          `.pipe(Effect.orDie)

          const row = rows[0]
          if (row === undefined) {
            const exists = yield* sql<{ readonly id: string }>`
              SELECT id FROM projects
              WHERE slug = ${projectSlug} AND archived_at IS NULL
              LIMIT 1
            `.pipe(Effect.orDie)
            if (exists[0] === undefined) {
              return yield* new NotFound()
            }
            return yield* new Forbidden()
          }

          if (!allowed.includes(row.role)) {
            return yield* new Forbidden()
          }

          return { projectId: row.project_id, role: row.role }
        }
      )

      return ProjectAuth.of({ requireRole })
    })
  )
}
