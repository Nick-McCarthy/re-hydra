import { execSqlScript } from "../execSqlScript.js"

/**
 * Audit phase 3.
 *
 * - I3: at most one unfinished interactive job per chunk. Submit already holds
 *   the chunk row lock and requires `leased`; this makes the database refuse
 *   a second in-flight job too.
 * - `jobs` had no index on `chunk_id` or `attempt_id`. The match worker and
 *   sweeper look up in-flight jobs by chunk, submit looks up a prior attempt's
 *   job, and deleting attempts or chunks cascades through both columns.
 * - `chunks.updated_at` lets the sweeper find projects whose board counts may
 *   be stale (A-016) without scanning every chunk.
 * - Measured on a 100k-chunk project: the board page scanned and sorted every
 *   chunk (about 55 ms), the stats recount took 15 ms, the sweeper scanned all
 *   chunks for orphaned `validating` rows, and the invalidated-match lookup
 *   scanned `matches`. The last four indexes cover those queries.
 */
export default execSqlScript(`
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_interactive
  ON jobs (chunk_id)
  WHERE kind = 'interactive' AND state IN ('queued', 'claimed');

CREATE INDEX IF NOT EXISTS jobs_chunk_id_idx
  ON jobs (chunk_id);

CREATE INDEX IF NOT EXISTS jobs_attempt_id_idx
  ON jobs (attempt_id);

CREATE INDEX IF NOT EXISTS chunks_updated_at_idx
  ON chunks (updated_at);

CREATE INDEX IF NOT EXISTS chunks_board_idx
  ON chunks (project_id, address, id)
  WHERE fuse_parent_id IS NULL;

CREATE INDEX IF NOT EXISTS chunks_project_state_live_idx
  ON chunks (project_id, state)
  WHERE fuse_parent_id IS NULL;

CREATE INDEX IF NOT EXISTS chunks_validating_idx
  ON chunks (updated_at)
  WHERE state = 'validating';

CREATE INDEX IF NOT EXISTS matches_chunk_id_idx
  ON matches (chunk_id);
`)
