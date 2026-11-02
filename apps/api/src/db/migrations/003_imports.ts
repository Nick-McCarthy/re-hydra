import { execSqlScript } from "../execSqlScript.js"

/** Import tracking + per-chunk type name refs for revalidation later. */
export default execSqlScript(`
CREATE TYPE import_state AS ENUM (
  'uploaded',
  'parsing',
  'ready',
  'failed'
);

CREATE TABLE imports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  binary_id         uuid REFERENCES binaries (id),
  export_sha256     bytea NOT NULL REFERENCES blobs (sha256),
  state             import_state NOT NULL DEFAULT 'uploaded',
  error_message     text,
  created_by        uuid NOT NULL REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz
);

CREATE INDEX imports_project_id_idx ON imports (project_id, created_at DESC);

CREATE TABLE chunk_type_refs (
  chunk_id    uuid NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
  type_name   text NOT NULL,
  PRIMARY KEY (chunk_id, type_name)
);

CREATE INDEX chunk_type_refs_type_name_idx
  ON chunk_type_refs (type_name);
`)
