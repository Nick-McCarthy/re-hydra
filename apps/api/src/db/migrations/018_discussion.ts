import { execSqlScript } from "../execSqlScript.js"

/**
 * Project discussion: threads with a flat list of posts.
 *
 * - A thread has a title and may point at one chunk. Its first post is the
 *   opening message. `last_post_at` orders the list (pinned first).
 * - Posts are soft-deleted (`deleted_at`), so a thread still reads in order
 *   with "post removed" in place. A deleted thread is hidden from the list.
 * - `thread_started` is the only activity kind; replies stay off the feed.
 *   The new enum value is not used in this migration.
 */
export default execSqlScript(`
ALTER TYPE project_event_kind ADD VALUE IF NOT EXISTS 'thread_started';

CREATE TABLE IF NOT EXISTS project_threads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  author_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  chunk_id      uuid REFERENCES chunks (id) ON DELETE SET NULL,
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  pinned        boolean NOT NULL DEFAULT false,
  locked        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_post_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  deleted_by    uuid REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS project_threads_list
  ON project_threads (project_id, pinned DESC, last_post_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS project_threads_by_chunk
  ON project_threads (chunk_id)
  WHERE deleted_at IS NULL AND chunk_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS project_posts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   uuid NOT NULL REFERENCES project_threads (id) ON DELETE CASCADE,
  author_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  edited_at   timestamptz,
  deleted_at  timestamptz,
  deleted_by  uuid REFERENCES users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS project_posts_by_thread
  ON project_posts (thread_id, created_at);
`)
