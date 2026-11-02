import { execSqlScript } from "../execSqlScript.js"

/** Follows, project activity, reputation inputs, and competing leases. */
export default execSqlScript(`
ALTER TABLE projects
  ADD COLUMN max_concurrent_leases integer NOT NULL DEFAULT 1
    CHECK (max_concurrent_leases >= 1 AND max_concurrent_leases <= 8);

CREATE TABLE chunk_leases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chunk_id          uuid NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users (id),
  lease_token       uuid NOT NULL,
  lease_expires_at  timestamptz NOT NULL,
  hold_started_at   timestamptz NOT NULL,
  released_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX chunk_leases_token_uidx
  ON chunk_leases (lease_token)
  WHERE released_at IS NULL;

CREATE UNIQUE INDEX chunk_leases_user_active_uidx
  ON chunk_leases (chunk_id, user_id)
  WHERE released_at IS NULL;

CREATE INDEX chunk_leases_chunk_active_idx
  ON chunk_leases (chunk_id)
  WHERE released_at IS NULL;

CREATE TYPE project_event_kind AS ENUM (
  'checkout',
  'release',
  'lease_expired',
  'lease_cleared',
  'matched',
  'match_missed',
  'imported',
  'proposal_opened',
  'proposal_accepted',
  'fused',
  'unresolved_marked',
  'unresolved_cleared',
  'became_stale',
  'settings_changed'
);

CREATE TABLE project_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES users (id),
  kind        project_event_kind NOT NULL,
  chunk_id    uuid REFERENCES chunks (id) ON DELETE SET NULL,
  subject_id  uuid,
  summary     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX project_events_project_created_idx
  ON project_events (project_id, created_at DESC);

CREATE INDEX project_events_actor_created_idx
  ON project_events (actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

CREATE TABLE follows (
  follower_id  uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  project_id   uuid REFERENCES projects (id) ON DELETE CASCADE,
  followee_id  uuid REFERENCES users (id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK ((project_id IS NULL) <> (followee_id IS NULL)),
  CHECK (followee_id IS NULL OR followee_id <> follower_id)
);

CREATE UNIQUE INDEX follows_project_uidx
  ON follows (follower_id, project_id)
  WHERE project_id IS NOT NULL;

CREATE UNIQUE INDEX follows_user_uidx
  ON follows (follower_id, followee_id)
  WHERE followee_id IS NOT NULL;

CREATE TABLE proposal_regressions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id uuid NOT NULL REFERENCES type_proposals (id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  chunk_id    uuid NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  caused_by   uuid NOT NULL REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, chunk_id)
);

CREATE INDEX proposal_regressions_caused_by_idx
  ON proposal_regressions (caused_by);
`)