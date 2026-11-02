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
