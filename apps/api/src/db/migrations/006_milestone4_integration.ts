import { execSqlScript } from "../execSqlScript.js"

/**
 * Integration (whole-image) builds, per-chunk byte diffs, and recipe rechecks
 * when the owner changes language or flags.
 *
 * Enum values are added here and not used in this migration. PostgreSQL only
 * allows a new enum value after the adding transaction commits, and the
 * migrator runs each migration in one transaction.
 */
export default execSqlScript(`
ALTER TYPE project_event_kind ADD VALUE IF NOT EXISTS 'integration_started';
ALTER TYPE project_event_kind ADD VALUE IF NOT EXISTS 'integration_passed';
ALTER TYPE project_event_kind ADD VALUE IF NOT EXISTS 'integration_failed';
ALTER TYPE project_event_kind ADD VALUE IF NOT EXISTS 'integration_reopened';

CREATE TYPE integration_status AS ENUM (
  'queued',
  'running',
  'passed',
  'failed',
  'error'
);

CREATE TABLE integrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  binary_id         uuid NOT NULL REFERENCES binaries (id) ON DELETE CASCADE,
  status            integration_status NOT NULL DEFAULT 'queued',
  started_by        uuid REFERENCES users (id),
  language          text NOT NULL,
  toolchain         jsonb NOT NULL,
  toolchain_digest  text,
  summary           text NOT NULL DEFAULT '',
  diagnostics       text,
  claimed_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz
);

CREATE INDEX integrations_project_created_idx
  ON integrations (project_id, created_at DESC);

CREATE UNIQUE INDEX integrations_one_active
  ON integrations (binary_id)
  WHERE status IN ('queued', 'running');

CREATE TABLE integration_units (
  integration_id  uuid NOT NULL REFERENCES integrations (id) ON DELETE CASCADE,
  chunk_id        uuid NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  name            text NOT NULL,
  address         bigint NOT NULL,
  size            integer NOT NULL,
  passed          boolean,
  detail          text NOT NULL DEFAULT '',
  PRIMARY KEY (integration_id, chunk_id)
);

CREATE TABLE recipe_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  chunk_id          uuid NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  attempt_id        uuid NOT NULL REFERENCES attempts (id) ON DELETE CASCADE,
  state             job_state NOT NULL DEFAULT 'queued',
  language          text NOT NULL,
  toolchain         jsonb NOT NULL,
  entry_symbol      text NOT NULL,
  original_sha256   bytea NOT NULL REFERENCES blobs (sha256),
  claimed_by        text,
  claim_expires_at  timestamptz,
  result            jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz
);

CREATE UNIQUE INDEX recipe_jobs_one_active
  ON recipe_jobs (chunk_id)
  WHERE state IN ('queued', 'claimed');

CREATE INDEX recipe_jobs_claim_idx
  ON recipe_jobs (created_at)
  WHERE state = 'queued';
`)