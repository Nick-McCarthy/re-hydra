import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { Activity } from "./Activity.js"
import { returnChunkToPool } from "./PoolReturn.js"
import { ProjectChunkStats } from "./ProjectChunkStats.js"

/** Returns forgotten leases to the open pool when lease_expires_at has passed. */
export const LeaseSweeperLive = Layer.effectDiscard(Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const stats = yield* ProjectChunkStats
  const activity = yield* Activity

  const sweep = Effect.gen(function*() {
    const expiredSides = yield* sql<{
      readonly chunk_id: string
      readonly project_id: string
      readonly name: string
      readonly user_id: string
    }>`
      UPDATE chunk_leases cl
      SET released_at = now()
      FROM chunks c
      WHERE cl.chunk_id = c.id
        AND cl.released_at IS NULL
        AND cl.lease_expires_at < now()
      RETURNING cl.chunk_id, cl.user_id, c.project_id, c.name
    `

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

    const touched = new Set<string>(expiredSides.map((row) => row.project_id))

    for (const chunk of expiredPrimaries) {
      const promoted = yield* sql.withTransaction(Effect.gen(function*() {
        const locked = yield* sql<{ readonly id: string }>`
          SELECT id
          FROM chunks
          WHERE id = ${chunk.id}
            AND state = 'leased'
            AND lease_expires_at < now()
          FOR UPDATE
        `
        if (locked[0] === undefined) {
          return false
        }

        const next = yield* sql<{
          readonly id: string
          readonly user_id: string
          readonly lease_token: string
          readonly lease_expires_at: Date | string
          readonly hold_started_at: Date | string
        }>`
          SELECT id, user_id, lease_token, lease_expires_at, hold_started_at
          FROM chunk_leases
          WHERE chunk_id = ${chunk.id}
            AND released_at IS NULL
            AND lease_expires_at > now()
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE
        `

        const holder = next[0]
        if (holder === undefined) {
          yield* returnChunkToPool(sql, chunk.id)
        } else {
          const promoted = yield* sql<{ readonly id: string }>`
            UPDATE chunks
            SET
              state = 'leased',
              lease_user_id = ${holder.user_id},
              lease_token = ${holder.lease_token},
              lease_expires_at = ${holder.lease_expires_at},
              hold_started_at = ${holder.hold_started_at},
              updated_at = now()
            WHERE id = ${chunk.id}
              AND state = 'leased'
              AND lease_expires_at < now()
            RETURNING id
          `
          if (promoted[0] !== undefined) {
            yield* sql`
              UPDATE chunk_leases
              SET released_at = now()
              WHERE id = ${holder.id}
                AND released_at IS NULL
            `
          }
        }

        yield* activity.record({
          projectId: chunk.project_id,
          kind: "lease_expired",
          chunkId: chunk.id,
          summary: `Lease expired on ${chunk.name}`
        })
        return true
      }))

      if (promoted) {
        touched.add(chunk.project_id)
      }
    }

    // Backstop for audit A-004. A chunk stays `validating` only while an
    // interactive job for it is queued or claimed. The match worker hands the
    // chunk back when a job fails. This catches anything that slipped past,
    // such as a job row removed by hand, after five quiet minutes.
    const orphaned = yield* sql<{ readonly id: string; readonly project_id: string; readonly name: string }>`
      UPDATE chunks AS c
      SET
        state = 'leased',
        lease_expires_at = COALESCE(
          c.lease_expires_at,
          now() + make_interval(hours => p.lease_hours)
        ),
        updated_at = now()
      FROM projects p
      WHERE c.project_id = p.id
        AND c.state = 'validating'
        AND c.updated_at < now() - interval '5 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM jobs j
          WHERE j.chunk_id = c.id
            AND j.kind = 'interactive'
            AND j.state IN ('queued', 'claimed')
        )
      RETURNING c.id, c.project_id, c.name
    `
    for (const chunk of orphaned) {
      touched.add(chunk.project_id)
      yield* Effect.logWarning(`returned ${chunk.name} (${chunk.id}) from validating with no job in flight`)
    }

    // Audit A-016. Two concurrent refreshes can commit in either order, so the
    // last write may hold stale counts. Recount every project whose chunks
    // changed in the last two minutes. Board counts converge within one tick
    // (30 seconds) of the last change. Locking the stats row instead would
    // deadlock with transactions that refresh and then lock another chunk.
    const recent = yield* sql<{ readonly project_id: string }>`
      SELECT DISTINCT project_id
      FROM chunks
      WHERE updated_at > now() - interval '2 minutes'
    `
    for (const row of recent) {
      touched.add(row.project_id)
    }

    for (const projectId of touched) {
      yield* stats.refresh(projectId)
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
