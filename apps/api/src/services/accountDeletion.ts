import { createHash } from "node:crypto"
import { Effect } from "effect"
import type { SqlClient } from "effect/sql"
import { AccountDeletionRefused } from "../domain/Problems.js"
import { returnChunkToPool } from "./PoolReturn.js"

/**
 * Account deletion (foundations plan 3, migration 028). Shared by
 * `POST /auth/delete-account` and `npm run api:admin -- delete-user`, so it
 * takes the SQL client and nothing else.
 *
 * In one transaction:
 * - refuses a suspended account, and one that owns a project that is not
 *   archived unless `archiveOwnedProjects` (those projects are then archived
 *   and the archive is recorded for the admins);
 * - keeps strikes against a hash of the email, so a new sign-up with that
 *   email takes them back (content policy 3);
 * - refuses while a submission of the account's is being checked (a
 *   `validating` chunk must have a holder until matchd answers);
 * - returns the account's leased chunks to the pool and releases the
 *   competing leases on them, as blocking a user does. The caller refreshes
 *   chunk stats for `touchedProjectIds`;
 * - deletes the user. Migration 028's rules do the rest: personal rows go,
 *   work stays with no author ("deleted account").
 */
export const emailHash = (email: string): Buffer =>
  createHash("sha256").update(email.trim().toLowerCase()).digest()

export interface DeletedAccount {
  readonly archivedProjects: ReadonlyArray<{ readonly slug: string; readonly name: string }>
  /** Projects whose chunk counts changed; refresh ProjectChunkStats for each. */
  readonly touchedProjectIds: ReadonlyArray<string>
}

export const deleteUserAccount = (
  sql: SqlClient.SqlClient,
  userId: string,
  options: { readonly archiveOwnedProjects: boolean }
) =>
  sql.withTransaction(Effect.gen(function*() {
    const users = yield* sql<{ readonly email: string; readonly suspended: boolean }>`
      SELECT email, (suspended_at IS NOT NULL) AS suspended FROM users WHERE id = ${userId} FOR UPDATE
    `
    const user = users[0]
    if (user === undefined) {
      return { archivedProjects: [], touchedProjectIds: [] } satisfies DeletedAccount
    }
    if (user.suspended) {
      return yield* new AccountDeletionRefused({
        reason: "suspended",
        detail: "This account is suspended. Restore it before deleting it, or keep it suspended."
      })
    }

    const owned = yield* sql<{ readonly id: string; readonly slug: string; readonly name: string }>`
      SELECT p.id, p.slug, p.name
      FROM project_members m
      INNER JOIN projects p ON p.id = m.project_id
      WHERE m.user_id = ${userId} AND m.role = 'owner' AND p.archived_at IS NULL
      ORDER BY p.name
      FOR UPDATE OF p
    `
    if (owned.length > 0 && !options.archiveOwnedProjects) {
      return yield* new AccountDeletionRefused({
        reason: "owns_projects",
        detail: `You own ${owned.length === 1 ? "a project" : `${owned.length} projects`}: ` +
          `${owned.map((p) => p.name).join(", ")}. Offer ownership to someone, or archive ` +
          `${owned.length === 1 ? "it" : "them"} as part of deleting your account.`
      })
    }
    for (const project of owned) {
      yield* sql`UPDATE projects SET archived_at = now() WHERE id = ${project.id}`
      yield* sql`
        INSERT INTO moderation_actions (admin_id, kind, project_id, note)
        VALUES (NULL, 'archive_project', ${project.id}, ${"Archived when its owner deleted their account."})
      `
      yield* sql`
        INSERT INTO project_events (project_id, actor_id, kind, summary)
        VALUES (${project.id}, NULL, 'settings_changed', ${"Archived: its owner deleted their account"})
      `
    }

    yield* sql`UPDATE strikes SET email_hash = ${emailHash(user.email)} WHERE user_id = ${userId}`

    // Locking the rows makes a concurrent submit wait, then find no lease.
    const held = yield* sql<{ readonly id: string; readonly project_id: string; readonly state: string }>`
      SELECT id, project_id, state FROM chunks
      WHERE lease_user_id = ${userId} AND state IN ('leased', 'validating')
      FOR UPDATE
    `
    if (held.some((chunk) => chunk.state === "validating")) {
      return yield* new AccountDeletionRefused({
        reason: "submission_checking",
        detail: "A submission of yours is still being checked. Try again in a minute."
      })
    }
    for (const chunk of held) {
      yield* returnChunkToPool(sql, chunk.id)
      yield* sql`UPDATE chunk_leases SET released_at = now() WHERE chunk_id = ${chunk.id} AND released_at IS NULL`
    }

    yield* sql`DELETE FROM users WHERE id = ${userId}`
    return {
      archivedProjects: owned.map(({ slug, name }) => ({ slug, name })),
      touchedProjectIds: [...new Set(held.map((chunk) => chunk.project_id))]
    } satisfies DeletedAccount
  }))

/** A new account with the email of a deleted one takes back its strikes. */
export const reclaimStrikes = (sql: SqlClient.SqlClient, userId: string, email: string) =>
  sql`
    UPDATE strikes SET user_id = ${userId}, email_hash = NULL
    WHERE user_id IS NULL AND email_hash = ${emailHash(email)}
  `
