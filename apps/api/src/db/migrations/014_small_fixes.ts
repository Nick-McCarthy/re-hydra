import { execSqlScript } from "../execSqlScript.js"

/**
 * Audit small fixes.
 *
 * - A-026: a type recheck that could not run (compile failure, missing input)
 *   keeps the match. It is now counted as unchecked, not as passed, so the
 *   proposal page can show it.
 * - A-015: a match job whose matchd call failed (outage, restart) goes back to
 *   the queue with a backoff instead of reporting a miss. `transport_retries`
 *   counts the tries, and `not_before` holds the job until the backoff ends.
 * - A-018: one API process at a time runs the matchd scaler. The leader holds
 *   a row that it renews every tick. Another process takes over when it lapses.
 * - A-028: substring search on the board uses trigram indexes on the name and
 *   on both address forms the query matches.
 */
export default execSqlScript(`
ALTER TABLE type_proposals
  ADD COLUMN IF NOT EXISTS revalidation_unchecked integer NOT NULL DEFAULT 0;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS transport_retries integer NOT NULL DEFAULT 0;

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS not_before timestamptz;

CREATE TABLE IF NOT EXISTS scaler_leader (
  id          integer PRIMARY KEY CHECK (id = 1),
  holder      text NOT NULL,
  expires_at  timestamptz NOT NULL
);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS chunks_name_trgm_idx
  ON chunks USING gin (name gin_trgm_ops)
  WHERE fuse_parent_id IS NULL;

CREATE INDEX IF NOT EXISTS chunks_address_trgm_idx
  ON chunks USING gin ((address::text) gin_trgm_ops)
  WHERE fuse_parent_id IS NULL;

CREATE INDEX IF NOT EXISTS chunks_hex_address_trgm_idx
  ON chunks USING gin (('0x' || to_hex(address)) gin_trgm_ops)
  WHERE fuse_parent_id IS NULL;
`)
