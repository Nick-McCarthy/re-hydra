import { execSqlScript } from "../execSqlScript.js"

/**
 * Audit A-032. matchd rejects inline assembly unless the chunk allows it,
 * because `__asm__(".byte …")` can reproduce the original bytes with no
 * translation. An owner or maintainer can allow it per chunk for code that
 * really was assembly. Matches record whether they used it, so the board and
 * profiles can mark them.
 */
export default execSqlScript(`
ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS allow_inline_asm boolean NOT NULL DEFAULT false;

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS uses_inline_asm boolean NOT NULL DEFAULT false;
`)
