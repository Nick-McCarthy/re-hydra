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
import migration009 from "./migrations/009_max_held_chunks.js"
import migration010 from "./migrations/010_passwords.js"
import migration011 from "./migrations/011_access_tokens.js"
import migration012 from "./migrations/012_job_integrity.js"
import migration013 from "./migrations/013_inline_asm.js"
import migration014 from "./migrations/014_small_fixes.js"
import migration015 from "./migrations/015_project_access.js"
import migration016 from "./migrations/016_project_members.js"
import migration017 from "./migrations/017_join_requests.js"
import migration018 from "./migrations/018_discussion.js"
import migration019 from "./migrations/019_password_resets.js"
import migration020 from "./migrations/020_binary_symbols.js"
import migration021 from "./migrations/021_integration_claim_token.js"
import migration022 from "./migrations/022_moderation.js"

const program = PgMigrator.run({
  loader: Migrator.fromRecord({
    "001_milestone1": migration001,
    "002_milestone1_queue": migration002,
    "003_imports": migration003,
    "004_milestone2_types": migration004,
    "005_milestone3_directory": migration005,
    "006_milestone4_integration": migration006,
    "007_stale_pool": migration007,
    "008_proposal_accept": migration008,
    "009_max_held_chunks": migration009,
    "010_passwords": migration010,
    "011_access_tokens": migration011,
    "012_job_integrity": migration012,
    "013_inline_asm": migration013,
    "014_small_fixes": migration014,
    "015_project_access": migration015,
    "016_project_members": migration016,
    "017_join_requests": migration017,
    "018_discussion": migration018,
    "019_password_resets": migration019,
    "020_binary_symbols": migration020,
    "021_integration_claim_token": migration021,
    "022_moderation": migration022
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
