import { Effect } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"

/**
 * End a lease on `open`, or on `stale` when a match was invalidated and has
 * not been replaced. The invalidated match stays the starting attempt and
 * stays out of the matched count.
 */
export const returnChunkToPool = (sql: SqlClient, chunkId: string) =>
  sql`
    UPDATE chunks AS c
    SET
      state = CASE
        WHEN c.current_match_id IS NULL AND EXISTS (
          SELECT 1 FROM matches m
          WHERE m.chunk_id = c.id AND m.invalidated_at IS NOT NULL
        ) THEN 'stale'::chunk_state
        ELSE 'open'::chunk_state
      END,
      lease_user_id = NULL,
      lease_token = NULL,
      lease_expires_at = NULL,
      hold_started_at = NULL,
      updated_at = now()
    WHERE c.id = ${chunkId}
      AND c.state = 'leased'
  `.pipe(Effect.orDie)

/**
 * End every lease one user holds on one project: their primary leases go
 * back to the pool and their competing leases are released. Used when a user
 * loses the right to work there (blocked, or removed from a members-only
 * project). Run inside the caller's transaction; the caller refreshes stats.
 */
export const endUserLeasesOnProject = (
  sql: SqlClient,
  releaseSideLeases: (chunkId: string) => Effect.Effect<void>,
  projectId: string,
  userId: string
) =>
  Effect.gen(function*() {
    const held = yield* sql<{ readonly id: string }>`
      SELECT id FROM chunks
      WHERE project_id = ${projectId}
        AND state = 'leased'
        AND lease_user_id = ${userId}
      FOR UPDATE
    `
    for (const chunk of held) {
      yield* returnChunkToPool(sql, chunk.id)
      yield* releaseSideLeases(chunk.id)
    }
    yield* sql`
      UPDATE chunk_leases cl
      SET released_at = now()
      FROM chunks c
      WHERE cl.chunk_id = c.id
        AND c.project_id = ${projectId}
        AND cl.user_id = ${userId}
        AND cl.released_at IS NULL
    `
    return held.length
  })
