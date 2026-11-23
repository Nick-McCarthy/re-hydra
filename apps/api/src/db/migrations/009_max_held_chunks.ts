import { execSqlScript } from "../execSqlScript.js"

/** How many chunks one person may hold on a project at the same time. */
export default execSqlScript(`
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS max_held_chunks integer NOT NULL DEFAULT 8
    CHECK (max_held_chunks >= 1 AND max_held_chunks <= 32);
`)