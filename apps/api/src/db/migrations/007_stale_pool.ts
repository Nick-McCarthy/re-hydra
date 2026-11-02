import { execSqlScript } from "../execSqlScript.js"

/**
 * A chunk whose match was invalidated belongs in `stale` until a new match
 * replaces it. Release used to leave those rows `open`.
 */
export default execSqlScript(`
UPDATE chunks AS c
SET
  state = 'stale',
  updated_at = now()
WHERE c.state = 'open'
  AND c.fuse_parent_id IS NULL
  AND c.current_match_id IS NULL
  AND EXISTS (
    SELECT 1 FROM matches m
    WHERE m.chunk_id = c.id AND m.invalidated_at IS NOT NULL
  );

UPDATE project_chunk_stats AS s
SET
  open_count = c.open_count,
  leased_count = c.leased_count,
  validating_count = c.validating_count,
  matched_count = c.matched_count,
  stale_count = c.stale_count,
  blocked_count = c.blocked_count,
  total_count = c.total_count,
  updated_at = now()
FROM (
  SELECT
    project_id,
    COUNT(*) FILTER (WHERE state = 'open')::int AS open_count,
    COUNT(*) FILTER (WHERE state = 'leased')::int AS leased_count,
    COUNT(*) FILTER (WHERE state = 'validating')::int AS validating_count,
    COUNT(*) FILTER (WHERE state = 'matched')::int AS matched_count,
    COUNT(*) FILTER (WHERE state = 'stale')::int AS stale_count,
    COUNT(*) FILTER (WHERE state = 'blocked')::int AS blocked_count,
    COUNT(*)::int AS total_count
  FROM chunks
  WHERE fuse_parent_id IS NULL
  GROUP BY project_id
) AS c
WHERE s.project_id = c.project_id
`)
