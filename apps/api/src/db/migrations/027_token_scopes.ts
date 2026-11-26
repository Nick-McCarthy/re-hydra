import { execSqlScript } from "../execSqlScript.js"

/**
 * Scoped profile tokens (foundations plan 2).
 *
 * `work`: contributor work only (check out, submit, heartbeat, release, read
 * the bundle, propose types) and reads of the holder's own data. Meant for
 * agents and scripts.
 * `all`: everything the account can do, like a browser session.
 *
 * Tokens from before this migration keep full access ('all'). New tokens
 * default to 'work' in the API.
 */
export default execSqlScript(`
ALTER TABLE access_tokens
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'all'
    CHECK (scope IN ('work', 'all'));
`)
