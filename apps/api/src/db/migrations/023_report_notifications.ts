import { execSqlScript } from "../execSqlScript.js"

/**
 * When the admins were emailed about a report. The report notifier claims
 * rows with no `notified_at`, emails every admin once per batch, and sets it
 * in the same transaction. Reports filed before this migration count as
 * already notified, so turning it on does not mail the whole backlog.
 */
export default execSqlScript(`
ALTER TABLE reports ADD COLUMN IF NOT EXISTS notified_at timestamptz;
UPDATE reports SET notified_at = created_at WHERE notified_at IS NULL;
CREATE INDEX IF NOT EXISTS reports_unnotified ON reports (created_at) WHERE notified_at IS NULL;
`)
