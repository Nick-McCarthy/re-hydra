import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import type { ProjectEventKind } from "../domain/Directory.js"

export class Activity extends Context.Service<
  Activity,
  {
    readonly record: (event: {
      readonly projectId: string
      readonly actorId?: string | null
      readonly kind: ProjectEventKind
      readonly chunkId?: string | null
      readonly subjectId?: string | null
      readonly summary: string
    }) => Effect.Effect<void>
    readonly releaseSideLeases: (chunkId: string) => Effect.Effect<void>
  }
>()("rehydra/services/Activity") {
  static readonly layer = Layer.effect(
    Activity,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient

      const record = Effect.fn("Activity.record")(function*(event: {
        readonly projectId: string
        readonly actorId?: string | null
        readonly kind: ProjectEventKind
        readonly chunkId?: string | null
        readonly subjectId?: string | null
        readonly summary: string
      }) {
        yield* sql`
          INSERT INTO project_events (
            project_id, actor_id, kind, chunk_id, subject_id, summary
          ) VALUES (
            ${event.projectId},
            ${event.actorId ?? null},
            ${event.kind},
            ${event.chunkId ?? null},
            ${event.subjectId ?? null},
            ${event.summary}
          )
        `.pipe(Effect.orDie)
      })

      const releaseSideLeases = Effect.fn("Activity.releaseSideLeases")(function*(
        chunkId: string
      ) {
        yield* sql`
          UPDATE chunk_leases
          SET released_at = now()
          WHERE chunk_id = ${chunkId}
            AND released_at IS NULL
        `.pipe(Effect.orDie)
      })

      return Activity.of({ record, releaseSideLeases })
    })
  )
}
