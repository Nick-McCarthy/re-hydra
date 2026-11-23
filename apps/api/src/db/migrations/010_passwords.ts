import { execSqlScript } from "../execSqlScript.js"

/** Password hashes replace magic-link sign-in. Existing accounts have a null hash until they set one. */
export default execSqlScript(`
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash text;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_password_hash_nonempty;

ALTER TABLE users
  ADD CONSTRAINT users_password_hash_nonempty
  CHECK (password_hash IS NULL OR length(password_hash) > 0);

DROP TABLE IF EXISTS magic_link_tokens;
`)
