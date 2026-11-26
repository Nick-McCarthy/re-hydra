import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { Activity } from "./Activity.js"
import { ChunkState } from "./ChunkState.js"
import { ProjectChunkStats } from "./ProjectChunkStats.js"

/** Returns forgotten leases to the open pool when lease_expires_at has passed. */
export const LeaseSweeperLive = Layer.effectDiscard(Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const stats = yield* ProjectChunkStats
  const chunkState = yield* ChunkState
  const activity = yield* Activity

  const sweep = Effect.gen(function*() {
    const expiredSides = yield* chunkState.expireCompetingLeases

    for (const row of expiredSides) {
      yield* activity.record({
        projectId: row.project_id,
        actorId: row.user_id,
        kind: "lease_expired",
        chunkId: row.chunk_id,
        summary: `Lease expired on ${row.name}`
      })
    }

    const expiredPrimaries = yield* sql<{
      readonly id: string
      readonly project_id: string
      readonly name: string
    }>`
      SELECT id, project_id, name
      FROM chunks
      WHERE state = 'leased'
        AND lease_expires_at IS NOT NULL
        AND lease_expires_at < now()
    `

    for (const chunk of expiredPrimaries) {
      yield* sql.withTransaction(Effect.gen(function*() {
        const expired = yield* chunkState.expireLease(chunk.id, chunk.project_id)
        if (!expired) return
        yield* activity.record({
          projectId: chunk.project_id,
          kind: "lease_expired",
          chunkId: chunk.id,
          summary: `Lease expired on ${chunk.name}`
        })
      }))
    }

    // Backstop for audit A-004. A chunk stays `validating` only while an
    // interactive job for it is queued or claimed. The match worker hands the
    // chunk back when a job fails. This catches anything that slipped past,
    // such as a job row removed by hand, after five quiet minutes.
    const orphaned = yield* chunkState.returnOrphanedValidating
    for (const chunk of orphaned) {
      yield* Effect.logWarning(`returned ${chunk.name} (${chunk.id}) from validating with no job in flight`)
    }

    // Audit A-016. Two concurrent refreshes can commit in either order, so the
    // last write may hold stale counts. Recount every project whose chunks
    // changed in the last two minutes; ChunkState has already recounted the
    // ones this sweep changed. Board counts converge within one tick
    // (30 seconds) of the last change. Locking the stats row instead would
    // deadlock with transactions that refresh and then lock another chunk.
    const recent = yield* sql<{ readonly project_id: string }>`
      SELECT DISTINCT project_id
      FROM chunks
      WHERE updated_at > now() - interval '2 minutes'
    `
    for (const row of recent) {
      yield* stats.refresh(row.project_id)
    }

    if (expiredSides.length > 0 || expiredPrimaries.length > 0) {
      yield* Effect.logInfo(
        `expired ${expiredPrimaries.length} primary lease(s) and ${expiredSides.length} competing lease(s)`
      )
    }
  }).pipe(Effect.orDie)

  yield* Effect.logInfo("lease sweeper started")
  yield* sweep.pipe(
    Effect.catchCause((cause) => Effect.logWarning("lease sweeper tick failed", cause)),
    Effect.andThen(Effect.sleep("30 seconds")),
    Effect.forever,
    Effect.forkScoped
  )
}))
