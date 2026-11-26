import { execSqlScript } from "../execSqlScript.js"

/**
 * Strikes outlive an attempt to delete the account (foundations plan 3a).
 *
 * Migration 024 made `strikes.user_id` ON DELETE CASCADE, so deleting an
 * account would erase its strikes, and the same person could sign up again
 * at zero, which defeats the repeat-infringer rule (content policy 3).
 * RESTRICT makes a delete fail while the account has strikes. When account
 * deletion is built, it decides what to keep (for example a hash of the email
 * to match a re-registration) before removing the user.
 */
export default execSqlScript(`
ALTER TABLE strikes DROP CONSTRAINT IF EXISTS strikes_user_id_fkey;
ALTER TABLE strikes ADD CONSTRAINT strikes_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT;
`)
