import { execSqlScript } from "../execSqlScript.js"

/** Type proposals, unresolved marks, and fuse-friendly overlap constraint. */
export default execSqlScript(`
CREATE TYPE proposal_state AS ENUM (
  'open',
  'revalidating',
  'accepted',
  'rejected',
  'withdrawn'
);

CREATE TABLE type_proposals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id            uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  base_revision_id      uuid NOT NULL REFERENCES type_revisions (id),
  headers_sha256        bytea NOT NULL REFERENCES blobs (sha256),
  title                 text NOT NULL,
  description           text NOT NULL DEFAULT '',
  affected_types        text[] NOT NULL DEFAULT '{}',
  state                 proposal_state NOT NULL DEFAULT 'open',
  created_by            uuid NOT NULL REFERENCES users (id),
  reviewed_by           uuid REFERENCES users (id),
  resulting_revision_id uuid REFERENCES type_revisions (id),
  revalidation_total    integer NOT NULL DEFAULT 0,
  revalidation_done     integer NOT NULL DEFAULT 0,
  revalidation_failed   integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  closed_at             timestamptz
);

CREATE INDEX type_proposals_project_state_idx
  ON type_proposals (project_id, state, created_at DESC);

ALTER TABLE jobs
  ADD CONSTRAINT jobs_proposal_fk
  FOREIGN KEY (proposal_id) REFERENCES type_proposals (id) ON DELETE CASCADE;

CREATE TABLE unresolved_types (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  type_name       text NOT NULL,
  reason          text NOT NULL DEFAULT '',
  created_by      uuid NOT NULL REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  cleared_at      timestamptz,
  cleared_by      uuid REFERENCES users (id)
);

CREATE UNIQUE INDEX unresolved_types_active
  ON unresolved_types (project_id, type_name)
  WHERE cleared_at IS NULL;

-- Members of a fuse group keep their rows but leave the overlap set so the
-- parent covering range can be inserted.
ALTER TABLE chunks DROP CONSTRAINT chunks_no_overlap;
ALTER TABLE chunks ADD CONSTRAINT chunks_no_overlap
  EXCLUDE USING gist (binary_id WITH =, addr_range WITH &&)
  WHERE (fuse_parent_id IS NULL);
`)
