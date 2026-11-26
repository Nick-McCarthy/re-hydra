import { execSqlScript } from "../execSqlScript.js"

/**
 * Account deletion (foundations plan 3). Every reference to users gets a
 * deliberate ON DELETE rule; migrations 001–008 had none, so deleting a user
 * failed while any of their rows existed.
 *
 * SET NULL, so the work outlives the account and shows as "deleted account":
 * projects and type revisions they created, attempts and matches (released
 * under CC0), imports, type proposals and their reviews, unresolved types,
 * project events, proposal regressions, integration builds, the leaseholder
 * of a chunk, and blocks they made (the block stays in force). NOT NULL is
 * dropped where needed.
 *
 * CASCADE, because the rows only mean something while the person exists:
 * chunk_leases (their competing leases) and ownership offers they made.
 *
 * Strikes: migration 026 made strikes.user_id RESTRICT so a repeat infringer
 * could not reset their count by deleting the account. Now deletion goes
 * through and keeps the strikes against a SHA-256 of the account's email
 * (`email_hash`); a new sign-up with that email takes them back.
 */
const setNull = [
  ["projects", "created_by"],
  ["type_revisions", "created_by"],
  ["chunks", "lease_user_id"],
  ["attempts", "user_id"],
  ["matches", "user_id"],
  ["imports", "created_by"],
  ["type_proposals", "created_by"],
  ["type_proposals", "revalidation_started_by"],
  ["type_proposals", "reviewed_by"],
  ["unresolved_types", "created_by"],
  ["unresolved_types", "cleared_by"],
  ["project_events", "actor_id"],
  ["proposal_regressions", "caused_by"],
  ["integrations", "started_by"],
  ["project_blocks", "blocked_by"],
  ["strikes", "user_id"]
] as const

const cascade = [
  ["chunk_leases", "user_id"],
  ["ownership_transfers", "offered_by"]
] as const

const reference = (table: string, column: string, rule: "SET NULL" | "CASCADE") => `
ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS ${table}_${column}_fkey;
ALTER TABLE ${table} ADD CONSTRAINT ${table}_${column}_fkey
  FOREIGN KEY (${column}) REFERENCES users (id) ON DELETE ${rule};`

export default execSqlScript(`
${setNull.map(([table, column]) => `ALTER TABLE ${table} ALTER COLUMN ${column} DROP NOT NULL;`).join("\n")}
${setNull.map(([table, column]) => reference(table, column, "SET NULL")).join("\n")}
${cascade.map(([table, column]) => reference(table, column, "CASCADE")).join("\n")}

ALTER TABLE strikes ADD COLUMN IF NOT EXISTS email_hash bytea;
CREATE INDEX IF NOT EXISTS strikes_email_hash ON strikes (email_hash) WHERE user_id IS NULL;
`)
