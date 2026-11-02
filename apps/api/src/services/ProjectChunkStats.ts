import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"

export class ProjectChunkStats extends Context.Service<
  ProjectChunkStats,
  {
    readonly refresh: (projectId: string) => Effect.Effect<void>
  }
>()("rehydra/services/ProjectChunkStats") {
  static readonly layer = Layer.effect(
    ProjectChunkStats,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient

      const refresh = Effect.fn("ProjectChunkStats.refresh")(
        function*(projectId: string) {
          const counts = yield* sql<{
            readonly open_count: number
            readonly leased_count: number
            readonly validating_count: number
            readonly matched_count: number
            readonly stale_count: number
            readonly blocked_count: number
            readonly total_count: number
          }>`
            SELECT
              COUNT(*) FILTER (WHERE state = 'open')::int AS open_count,
              COUNT(*) FILTER (WHERE state = 'leased')::int AS leased_count,
              COUNT(*) FILTER (WHERE state = 'validating')::int AS validating_count,
              COUNT(*) FILTER (WHERE state = 'matched')::int AS matched_count,
              COUNT(*) FILTER (WHERE state = 'stale')::int AS stale_count,
              COUNT(*) FILTER (WHERE state = 'blocked')::int AS blocked_count,
              COUNT(*)::int AS total_count
            FROM chunks
            WHERE project_id = ${projectId}
              AND fuse_parent_id IS NULL
          `

          const row = counts[0]
          if (row === undefined) return

          yield* sql`
            INSERT INTO project_chunk_stats (
              project_id, open_count, leased_count, validating_count,
              matched_count, stale_count, blocked_count, total_count
            ) VALUES (
              ${projectId},
              ${row.open_count},
              ${row.leased_count},
              ${row.validating_count},
              ${row.matched_count},
              ${row.stale_count},
              ${row.blocked_count},
              ${row.total_count}
            )
            ON CONFLICT (project_id) DO UPDATE SET
              open_count = EXCLUDED.open_count,
              leased_count = EXCLUDED.leased_count,
              validating_count = EXCLUDED.validating_count,
              matched_count = EXCLUDED.matched_count,
              stale_count = EXCLUDED.stale_count,
              blocked_count = EXCLUDED.blocked_count,
              total_count = EXCLUDED.total_count,
              updated_at = now()
          `
        },
        Effect.orDie
      )

      return ProjectChunkStats.of({ refresh })
    })
  )
}
