import { Effect } from "effect"
import { SqlClient } from "effect/sql"

/**
 * Run a DDL script as one statement at a time.
 * `@effect/sql-pg` uses the extended query protocol, which rejects
 * multi-command strings ("cannot insert multiple commands into a prepared statement").
 */
export const execSqlScript = Effect.fn("execSqlScript")(function*(script: string) {
  const sql = yield* SqlClient.SqlClient
  const statements = script
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  for (const statement of statements) {
    yield* sql.unsafe(statement)
  }
})
