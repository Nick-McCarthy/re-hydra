/**
 * Grant or revoke site admin from the command line. There is no way to do
 * this in the app: the first admin has to come from someone with database
 * access, and later ones too, so a stolen admin session cannot mint more.
 *
 *   npm run admin -w @re-hydra/api -- grant someone@example.com
 *   npm run admin -w @re-hydra/api -- revoke someone@example.com
 *   npm run admin -w @re-hydra/api -- list
 *
 * Also deletes an account on a request by email (privacy policy section 7),
 * with the same rules as deleting it from the profile page. An owner of
 * projects that are not archived is refused unless --archive-projects:
 *
 *   npm run admin -w @re-hydra/api -- delete-user someone@example.com [--archive-projects]
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { deleteUserAccount } from "../services/accountDeletion.js"
import { ProjectChunkStats } from "../services/ProjectChunkStats.js"
import { SqlLive } from "./SqlLive.js"

const [command, email, ...flags] = process.argv.slice(2)

const program = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  if (command === "list") {
    const admins = yield* sql<{ readonly email: string; readonly display_name: string }>`
      SELECT email, display_name FROM users WHERE is_admin ORDER BY email
    `
    yield* Console.log(admins.length === 0 ? "No admins." : admins.map((a) => `${a.email}  (${a.display_name})`).join("\n"))
    return
  }

  if (command === "delete-user" && email !== undefined) {
    const found = yield* sql<{ readonly id: string }>`SELECT id FROM users WHERE email = ${email.trim()} LIMIT 1`
    if (found[0] === undefined) {
      yield* Console.error(`No account with the email ${email}.`)
      process.exitCode = 1
      return
    }
    const outcome = yield* deleteUserAccount(sql, found[0].id, {
      archiveOwnedProjects: flags.includes("--archive-projects")
    }).pipe(Effect.catchTag("AccountDeletionRefused", (refused) =>
      Effect.gen(function*() {
        const hint = refused.reason === "owns_projects" ? " Add --archive-projects to archive them." : ""
        yield* Console.error(`${refused.detail ?? "Refused."}${hint}`)
        process.exitCode = 1
        return undefined
      })
    ))
    if (outcome === undefined) return
    const stats = yield* ProjectChunkStats
    for (const projectId of outcome.touchedProjectIds) {
      yield* stats.refresh(projectId)
    }
    yield* Console.log(`Deleted the account for ${email}.`)
    for (const project of outcome.archivedProjects) {
      yield* Console.log(`Archived ${project.name} (${project.slug}).`)
    }
    return
  }

  if ((command !== "grant" && command !== "revoke") || email === undefined) {
    yield* Console.error(
      "Usage: admin grant <email> | admin revoke <email> | admin list | admin delete-user <email> [--archive-projects]"
    )
    process.exitCode = 1
    return
  }

  const grant = command === "grant"
  const users = yield* sql<{ readonly id: string; readonly is_admin: boolean; readonly suspended: boolean }>`
    SELECT id, is_admin, (suspended_at IS NOT NULL) AS suspended FROM users WHERE email = ${email.trim()} LIMIT 1
  `
  const user = users[0]
  if (user === undefined) {
    yield* Console.error(`No account with the email ${email}.`)
    process.exitCode = 1
    return
  }
  if (grant && user.suspended) {
    yield* Console.error("That account is suspended. Restore it before granting admin.")
    process.exitCode = 1
    return
  }
  if (user.is_admin === grant) {
    yield* Console.log(grant ? "Already an admin." : "Not an admin.")
    return
  }
  yield* sql.withTransaction(Effect.gen(function*() {
    yield* sql`UPDATE users SET is_admin = ${grant} WHERE id = ${user.id}`
    yield* sql`
      INSERT INTO moderation_actions (admin_id, kind, user_id, note)
      VALUES (NULL, ${grant ? "grant_admin" : "revoke_admin"}, ${user.id}, ${"from the command line"})
    `
  }))
  yield* Console.log(grant ? `${email} is now an admin.` : `${email} is no longer an admin.`)
}).pipe(Effect.provide(Layer.mergeAll(ProjectChunkStats.layer.pipe(Layer.provideMerge(SqlLive)), NodeServices.layer)))

NodeRuntime.runMain(program)
