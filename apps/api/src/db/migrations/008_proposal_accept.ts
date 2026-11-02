import { execSqlScript } from "../execSqlScript.js"

/**
 * `ready` is the state after revalidation when a second owner or maintainer
 * must accept. The new enum value is not used in this migration.
 */
export default execSqlScript(`
ALTER TYPE proposal_state ADD VALUE IF NOT EXISTS 'ready';

ALTER TYPE project_event_kind ADD VALUE IF NOT EXISTS 'proposal_ready';

ALTER TABLE type_proposals
  ADD COLUMN IF NOT EXISTS revalidation_started_by uuid REFERENCES users (id);
`)
