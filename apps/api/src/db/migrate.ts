import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { PgMigrator } from "@effect/sql-pg"
import { Console, Effect, Layer } from "effect"
import { Migrator } from "effect/sql"
import { SqlLive } from "./SqlLive.js"
import migration001 from "./migrations/001_milestone1.js"
import migration002 from "./migrations/002_milestone1_queue.js"
import migration003 from "./migrations/003_imports.js"
import migration004 from "./migrations/004_milestone2_types.js"
import migration005 from "./migrations/005_milestone3_directory.js"
import migration006 from "./migrations/006_milestone4_integration.js"
import migration007 from "./migrations/007_stale_pool.js"
import migration008 from "./migrations/008_proposal_accept.js"

const program = PgMigrator.run({
  loader: Migrator.fromRecord({
    "001_milestone1": migration001,
    "002_milestone1_queue": migration002,
    "003_imports": migration003,
    "004_milestone2_types": migration004,
    "005_milestone3_directory": migration005,
    "006_milestone4_integration": migration006,
    "007_stale_pool": migration007,
    "008_proposal_accept": migration008
  })
}).pipe(
  Effect.tap((applied) =>
    Console.log(
      applied.length === 0
        ? "No pending migrations."
        : `Applied migrations: ${applied.map(([id, name]) => `${id}_${name}`).join(", ")}`
    )
  ),
  Effect.provide(Layer.mergeAll(SqlLive, NodeServices.layer))
)

NodeRuntime.runMain(program)
