import { execSqlScript } from "../execSqlScript.js"

/**
 * Audit A-012.
 *
 * - `projects.checkout_policy`: 'open' (any signed-in user may check out,
 *   submit, and propose types; the default) or 'members' (only project
 *   members may).
 * - `project_blocks`: users an owner or maintainer has blocked from one
 *   project. A blocked user cannot check out, heartbeat, submit, or propose
 *   types there, whatever the policy.
 */
export default execSqlScript(`
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS checkout_policy text NOT NULL DEFAULT 'open'
    CHECK (checkout_policy IN ('open', 'members'));

CREATE TABLE IF NOT EXISTS project_blocks (
  project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_by  uuid NOT NULL REFERENCES users (id),
  reason      text NOT NULL DEFAULT '' CHECK (length(reason) <= 200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
`)
