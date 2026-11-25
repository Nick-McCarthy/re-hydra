import { execSqlScript } from "../execSqlScript.js"

/**
 * Content policy 2.4 and 2.5.
 *
 * `attempts.source_license`: the license the submitter released the source
 * under (CC0-1.0). Attempts from before this migration have none recorded.
 *
 * `strikes`: an admin's finding against an account under the repeat-infringer
 * rule. A strike counts while it is not reversed and less than 12 months old;
 * reversing (a counter-notice, a mistake) keeps the row with who and why.
 */
export default execSqlScript(`
ALTER TABLE attempts ADD COLUMN IF NOT EXISTS source_license text;

CREATE TABLE IF NOT EXISTS strikes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  admin_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  note           text NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  created_at     timestamptz NOT NULL DEFAULT now(),
  reversed_at    timestamptz,
  reversed_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  reversal_note  text CHECK (reversal_note IS NULL OR length(reversal_note) BETWEEN 1 AND 2000),
  CHECK ((reversed_at IS NULL) = (reversal_note IS NULL))
);
CREATE INDEX IF NOT EXISTS strikes_by_user ON strikes (user_id, created_at DESC);

ALTER TABLE moderation_actions DROP CONSTRAINT IF EXISTS moderation_actions_kind_check;
ALTER TABLE moderation_actions ADD CONSTRAINT moderation_actions_kind_check CHECK (kind IN (
  'archive_project', 'restore_project', 'remove_post',
  'suspend_user', 'restore_user', 'resolve_report',
  'grant_admin', 'revoke_admin', 'add_strike', 'reverse_strike'));
`)
