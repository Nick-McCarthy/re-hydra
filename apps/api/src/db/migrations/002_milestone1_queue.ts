import { execSqlScript } from "../execSqlScript.js"

/**
 * Auth tokens, attempts, match jobs, matches, local blob bytes, project stats.
 */
export default execSqlScript(`
CREATE TYPE job_kind AS ENUM ('interactive', 'revalidation');

CREATE TYPE job_state AS ENUM (
  'queued',
  'claimed',
  'succeeded',
  'failed'
);

CREATE TABLE magic_link_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users (id) ON DELETE CASCADE,
  email       citext NOT NULL,
  token_hash  bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (consumed_at IS NULL OR consumed_at <= now() + interval '1 minute')
);

CREATE INDEX magic_link_tokens_expires_at_idx
  ON magic_link_tokens (expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id)
  WHERE revoked_at IS NULL;

-- Local stand-in for object storage until S3 lands.
CREATE TABLE blob_objects (
  sha256 bytea PRIMARY KEY REFERENCES blobs (sha256) ON DELETE CASCADE,
  bytes  bytea NOT NULL
);

CREATE TABLE attempts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id           uuid NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users (id),
  lease_token        uuid NOT NULL,
  source_sha256      bytea NOT NULL REFERENCES blobs (sha256),
  type_revision_id   uuid NOT NULL REFERENCES type_revisions (id),
  language           text NOT NULL,
  score              numeric(6,5),
  matched            boolean,
  original_insns     integer,
  equal_insns        integer,
  compiler_ok        boolean,
  diagnostics        text,
  toolchain_digest   text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  UNIQUE (chunk_id, lease_token, source_sha256)
);

CREATE INDEX attempts_chunk_score_idx
  ON attempts (chunk_id, score DESC NULLS LAST, created_at DESC);

CREATE INDEX attempts_user_id_idx
  ON attempts (user_id, created_at DESC);

ALTER TABLE chunks
  ADD CONSTRAINT chunks_best_attempt_fk
  FOREIGN KEY (best_attempt_id) REFERENCES attempts (id);

CREATE TABLE matches (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id             uuid NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  attempt_id           uuid NOT NULL UNIQUE REFERENCES attempts (id),
  user_id              uuid NOT NULL REFERENCES users (id),
  type_revision_id     uuid NOT NULL REFERENCES type_revisions (id),
  toolchain_digest     text NOT NULL,
  canonical_sha256     bytea NOT NULL REFERENCES blobs (sha256),
  language             text NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  invalidated_at       timestamptz,
  invalidated_reason   text
);

CREATE UNIQUE INDEX matches_one_active_per_chunk
  ON matches (chunk_id)
  WHERE invalidated_at IS NULL;

CREATE INDEX matches_user_id_idx ON matches (user_id, created_at DESC);

ALTER TABLE chunks
  ADD CONSTRAINT chunks_current_match_fk
  FOREIGN KEY (current_match_id) REFERENCES matches (id);

CREATE TABLE jobs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  chunk_id           uuid NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  attempt_id         uuid REFERENCES attempts (id) ON DELETE CASCADE,
  proposal_id        uuid,
  kind               job_kind NOT NULL,
  state              job_state NOT NULL DEFAULT 'queued',
  priority           smallint NOT NULL DEFAULT 100,
  toolchain          jsonb NOT NULL,
  language           text NOT NULL,
  entry_symbol       text NOT NULL,
  original_sha256    bytea NOT NULL REFERENCES blobs (sha256),
  sources            jsonb NOT NULL,
  claimed_by         text,
  claim_expires_at   timestamptz,
  result             jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  CHECK (
    (kind = 'interactive' AND attempt_id IS NOT NULL)
    OR
    (kind = 'revalidation' AND proposal_id IS NOT NULL)
  )
);

CREATE INDEX jobs_claim_idx
  ON jobs (priority ASC, created_at ASC)
  WHERE state = 'queued';

CREATE INDEX jobs_claimed_expiry_idx
  ON jobs (claim_expires_at)
  WHERE state = 'claimed';

CREATE INDEX jobs_project_id_idx ON jobs (project_id, created_at DESC);

CREATE TABLE project_chunk_stats (
  project_id   uuid PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  open_count   integer NOT NULL DEFAULT 0,
  leased_count integer NOT NULL DEFAULT 0,
  validating_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  stale_count  integer NOT NULL DEFAULT 0,
  blocked_count integer NOT NULL DEFAULT 0,
  total_count  integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (open_count + leased_count + validating_count
       + matched_count + stale_count + blocked_count = total_count)
);

CREATE TABLE chunk_callees (
  caller_id   uuid NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  callee_id   uuid NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  PRIMARY KEY (caller_id, callee_id),
  CHECK (caller_id <> callee_id)
);

CREATE INDEX chunk_callees_callee_id_idx ON chunk_callees (callee_id);
`)
