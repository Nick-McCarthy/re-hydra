import { Effect } from "effect"
import type { SqlClient } from "effect/sql"

export const enqueueRecipeForProject = (
  sql: SqlClient.SqlClient,
  projectId: string
) =>
  sql`
    INSERT INTO recipe_jobs (
      project_id, chunk_id, attempt_id, language, toolchain,
      entry_symbol, original_sha256
    )
    SELECT
      c.project_id,
      c.id,
      c.best_attempt_id,
      COALESCE(c.language_override, p.language),
      p.toolchain,
      c.name,
      c.bytes_sha256
    FROM chunks c
    INNER JOIN projects p ON p.id = c.project_id
    WHERE c.project_id = ${projectId}
      AND c.state = 'matched'
      AND c.fuse_parent_id IS NULL
      AND c.current_match_id IS NOT NULL
      AND c.best_attempt_id IS NOT NULL
    ON CONFLICT (chunk_id) WHERE state IN ('queued', 'claimed') DO NOTHING
  `.pipe(Effect.orDie)

export const enqueueRecipeForChunk = (
  sql: SqlClient.SqlClient,
  chunkId: string
) =>
  sql`
    INSERT INTO recipe_jobs (
      project_id, chunk_id, attempt_id, language, toolchain,
      entry_symbol, original_sha256
    )
    SELECT
      c.project_id,
      c.id,
      c.best_attempt_id,
      COALESCE(c.language_override, p.language),
      p.toolchain,
      c.name,
      c.bytes_sha256
    FROM chunks c
    INNER JOIN projects p ON p.id = c.project_id
    WHERE c.id = ${chunkId}
      AND c.state = 'matched'
      AND c.fuse_parent_id IS NULL
      AND c.current_match_id IS NOT NULL
      AND c.best_attempt_id IS NOT NULL
    ON CONFLICT (chunk_id) WHERE state IN ('queued', 'claimed') DO NOTHING
  `.pipe(Effect.orDie)
