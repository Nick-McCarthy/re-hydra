/**
 * Grant or revoke site admin from the command line. There is no way to do
 * this in the app: the first admin has to come from someone with database
 * access, and later ones too, so a stolen admin session cannot mint more.
 *
 *   npm run admin -w @re-hydra/api -- grant someone@example.com
 *   npm run admin -w @re-hydra/api -- revoke someone@example.com
 *   npm run admin -w @re-hydra/api -- list
 */
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { SqlLive } from "./SqlLive.js"

const [command, email] = process.argv.slice(2)

const program = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  if (command === "list") {
    const admins = yield* sql<{ readonly email: string; readonly display_name: string }>`
      SELECT email, display_name FROM users WHERE is_admin ORDER BY email
    `
    yield* Console.log(admins.length === 0 ? "No admins." : admins.map((a) => `${a.email}  (${a.display_name})`).join("\n"))
    return
  }

  if ((command !== "grant" && command !== "revoke") || email === undefined) {
    yield* Console.error("Usage: admin grant <email> | admin revoke <email> | admin list")
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
}).pipe(Effect.provide(Layer.mergeAll(SqlLive, NodeServices.layer)))

NodeRuntime.runMain(program)
