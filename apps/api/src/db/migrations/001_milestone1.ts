import { execSqlScript } from "../execSqlScript.js"

/**
 * Milestone 1 tables needed for exclusive checkout.
 * Full schema lives in docs/db-schema/schema.md — this migration is the runnable subset.
 */
export default execSqlScript(`
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE member_role AS ENUM ('owner', 'maintainer', 'contributor');

CREATE TYPE chunk_state AS ENUM (
  'open',
  'leased',
  'validating',
  'matched',
  'stale',
  'blocked'
);

CREATE TABLE blobs (
  sha256       bytea PRIMARY KEY CHECK (octet_length(sha256) = 32),
  size_bytes   bigint NOT NULL CHECK (size_bytes >= 0),
  content_type text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);

CREATE INDEX users_display_name_trgm
  ON users USING gin (display_name gin_trgm_ops);

CREATE TABLE projects (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             citext NOT NULL UNIQUE,
  name             text NOT NULL,
  description      text NOT NULL DEFAULT '',
  home_region      text NOT NULL,
  language         text NOT NULL,
  toolchain        jsonb NOT NULL,
  lease_hours      integer NOT NULL DEFAULT 24
                     CHECK (lease_hours > 0 AND lease_hours <= 168),
  max_hold_hours   integer NOT NULL DEFAULT 48
                     CHECK (max_hold_hours >= lease_hours
                        AND max_hold_hours <= 336),
  created_by       uuid NOT NULL REFERENCES users (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  archived_at      timestamptz
);

CREATE TABLE project_members (
  project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role        member_role NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

CREATE UNIQUE INDEX project_members_one_owner
  ON project_members (project_id)
  WHERE role = 'owner';

CREATE INDEX project_members_user_id_idx
  ON project_members (user_id);

CREATE TABLE binaries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  sha256          bytea NOT NULL REFERENCES blobs (sha256),
  arch            text NOT NULL,
  name            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, sha256)
);

CREATE TABLE type_revisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  revision        integer NOT NULL,
  headers_sha256  bytea NOT NULL REFERENCES blobs (sha256),
  created_by      uuid NOT NULL REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, revision)
);

CREATE TABLE chunks (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id           uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  binary_id            uuid NOT NULL REFERENCES binaries (id) ON DELETE CASCADE,
  name                 text NOT NULL,
  address              bigint NOT NULL CHECK (address >= 0),
  size                 integer NOT NULL CHECK (size > 0),
  addr_range           int8range GENERATED ALWAYS AS
                         (int8range(address, address + size, '[)')) STORED,
  bytes_sha256         bytea NOT NULL REFERENCES blobs (sha256),
  pseudocode_sha256    bytea NOT NULL REFERENCES blobs (sha256),
  disassembly_sha256   bytea NOT NULL REFERENCES blobs (sha256),
  language_override    text,
  state                chunk_state NOT NULL DEFAULT 'open',
  lease_user_id        uuid REFERENCES users (id),
  lease_token          uuid,
  lease_expires_at     timestamptz,
  hold_started_at      timestamptz,
  type_revision_id     uuid REFERENCES type_revisions (id),
  current_match_id     uuid,
  best_attempt_id      uuid,
  fuse_parent_id       uuid REFERENCES chunks (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (address + size > address),
  CHECK (
    (state = 'open' AND lease_user_id IS NULL
                    AND lease_token IS NULL
                    AND lease_expires_at IS NULL
                    AND hold_started_at IS NULL)
    OR
    (state = 'leased' AND lease_user_id IS NOT NULL
                      AND lease_token IS NOT NULL
                      AND lease_expires_at IS NOT NULL
                      AND hold_started_at IS NOT NULL)
    OR
    (state = 'validating' AND lease_user_id IS NOT NULL
                          AND lease_token IS NOT NULL
                          AND hold_started_at IS NOT NULL)
    OR
    (state IN ('matched', 'stale', 'blocked')
       AND lease_user_id IS NULL
       AND lease_token IS NULL
       AND lease_expires_at IS NULL)
  ),
  CHECK (fuse_parent_id IS NULL OR fuse_parent_id <> id)
);

CREATE UNIQUE INDEX chunks_binary_bytes_addr
  ON chunks (binary_id, bytes_sha256, address, size);

ALTER TABLE chunks ADD CONSTRAINT chunks_no_overlap
  EXCLUDE USING gist (binary_id WITH =, addr_range WITH &&);

CREATE UNIQUE INDEX chunks_lease_token_uidx
  ON chunks (lease_token)
  WHERE lease_token IS NOT NULL;

CREATE INDEX chunks_project_state_addr_idx
  ON chunks (project_id, state, address);

CREATE INDEX chunks_lease_expiry_idx
  ON chunks (lease_expires_at)
  WHERE state = 'leased';

CREATE INDEX chunks_lease_user_idx
  ON chunks (lease_user_id)
  WHERE lease_user_id IS NOT NULL;

CREATE INDEX chunks_fuse_parent_idx
  ON chunks (fuse_parent_id)
  WHERE fuse_parent_id IS NOT NULL;

CREATE INDEX chunks_binary_open_idx
  ON chunks (binary_id)
  WHERE state = 'open';
`)
