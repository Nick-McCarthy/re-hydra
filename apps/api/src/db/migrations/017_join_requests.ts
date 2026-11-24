import { execSqlScript } from "../execSqlScript.js"

/**
 * Join requests for members-only projects.
 *
 * A signed-in user who is not a member asks to join; an owner or maintainer
 * approves (the user becomes a contributor) or declines. One open request
 * per user per project. After a decline the user may ask again 7 days later
 * (checked in code from `resolved_at`).
 */
export default execSqlScript(`
CREATE TABLE IF NOT EXISTS join_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  message      text NOT NULL DEFAULT '' CHECK (length(message) <= 200),
  state        text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'approved', 'declined', 'cancelled')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz,
  resolved_by  uuid REFERENCES users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS join_requests_one_open
  ON join_requests (project_id, user_id)
  WHERE state = 'open';

CREATE INDEX IF NOT EXISTS join_requests_open_by_project
  ON join_requests (project_id, created_at)
  WHERE state = 'open';

CREATE INDEX IF NOT EXISTS join_requests_by_user
  ON join_requests (user_id, created_at DESC);
`)
