import { execSqlScript } from "../execSqlScript.js"

/**
 * What the content policy promises before it is published
 * (docs/content-policy.md section 6): site admins, suspended accounts,
 * agreeing to the policy at sign-up, a rights confirmation on each import,
 * reports from users, and a record of every moderation action.
 */
export default execSqlScript(`
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS policy_version text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS policy_accepted_at timestamptz;

ALTER TABLE imports ADD COLUMN IF NOT EXISTS rights_confirmed_at timestamptz;
ALTER TABLE imports ADD COLUMN IF NOT EXISTS rights_confirmed_by uuid REFERENCES users (id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  project_id   uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  chunk_id     uuid REFERENCES chunks (id) ON DELETE CASCADE,
  post_id      uuid REFERENCES project_posts (id) ON DELETE CASCADE,
  reason       text NOT NULL CHECK (reason IN ('copyright', 'malware', 'abuse', 'other')),
  body         text NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  resolution   text CHECK (resolution IS NULL OR length(resolution) BETWEEN 1 AND 2000),
  CHECK ((resolved_at IS NULL) = (resolution IS NULL))
);
CREATE INDEX IF NOT EXISTS reports_open ON reports (created_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS reports_by_project ON reports (project_id, created_at);

CREATE TABLE IF NOT EXISTS moderation_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN (
                'archive_project', 'restore_project', 'remove_post',
                'suspend_user', 'restore_user', 'resolve_report',
                'grant_admin', 'revoke_admin')),
  project_id  uuid REFERENCES projects (id) ON DELETE SET NULL,
  user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  post_id     uuid REFERENCES project_posts (id) ON DELETE SET NULL,
  report_id   uuid REFERENCES reports (id) ON DELETE SET NULL,
  note        text NOT NULL CHECK (length(note) BETWEEN 1 AND 2000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moderation_actions_recent ON moderation_actions (created_at DESC);
`)
