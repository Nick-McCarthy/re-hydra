import { execSqlScript } from "../execSqlScript.js"

/**
 * Password reset by emailed link.
 *
 * Only the SHA-256 of the token is stored, like sessions and access tokens.
 * A token is good for one hour and one use. Asking again replaces any
 * unused token for that user (marked used, so it stops working).
 */
export default execSqlScript(`
CREATE TABLE IF NOT EXISTS password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);

CREATE INDEX IF NOT EXISTS password_resets_open_by_user
  ON password_resets (user_id)
  WHERE used_at IS NULL;
`)
