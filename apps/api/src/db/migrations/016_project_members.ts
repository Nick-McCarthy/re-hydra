import { execSqlScript } from "../execSqlScript.js"

/**
 * Audit A-011: membership management.
 *
 * - `members_changed`: activity feed kind for joins, role changes, removals,
 *   and ownership transfers. The new enum value is not used in this migration.
 * - `ownership_transfers`: an owner offers the project to another user, who
 *   accepts or declines. At most one open offer per project. An open offer
 *   past `expires_at` is treated as expired and marked so on the next write.
 */
export default execSqlScript(`
ALTER TYPE project_event_kind ADD VALUE IF NOT EXISTS 'members_changed';

CREATE TABLE IF NOT EXISTS ownership_transfers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  offered_by   uuid NOT NULL REFERENCES users (id),
  offered_to   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  state        text NOT NULL DEFAULT 'open'
    CHECK (state IN ('open', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '7 days',
  resolved_at  timestamptz,
  CHECK (offered_by <> offered_to)
);

CREATE UNIQUE INDEX IF NOT EXISTS ownership_transfers_one_open
  ON ownership_transfers (project_id)
  WHERE state = 'open';

CREATE INDEX IF NOT EXISTS ownership_transfers_offered_to_idx
  ON ownership_transfers (offered_to)
  WHERE state = 'open';
`)
