import { execSqlScript } from "../execSqlScript.js"

/** Profile tokens for the CLI. The raw secret is shown once; only the hash is stored. */
export default execSqlScript(`
CREATE TABLE IF NOT EXISTS access_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label        text NOT NULL CHECK (length(label) >= 1 AND length(label) <= 80),
  token_hash   bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

CREATE INDEX IF NOT EXISTS access_tokens_user_id_idx
  ON access_tokens (user_id)
  WHERE revoked_at IS NULL;
`)
