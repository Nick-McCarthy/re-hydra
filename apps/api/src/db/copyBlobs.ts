import { NodeRuntime } from "@effect/platform-node"
import { Config, Console, Effect, Layer, Option } from "effect"
import { SqlClient } from "effect/sql"
import { Blobs } from "../services/Blobs.js"
import { SqlLive } from "./SqlLive.js"

const program = Effect.gen(function*() {
  const mode = yield* Config.String("BLOB_STORE").pipe(Config.withDefault("postgres"))
  if (mode !== "s3") {
    yield* Console.log("BLOB_STORE is postgres. Set BLOB_STORE=s3 to copy bytes into the bucket.")
    return
  }

  const sql = yield* SqlClient.SqlClient
  const blobs = yield* Blobs
  const rows = yield* sql<{
    readonly sha256: Uint8Array
    readonly content_type: string
    readonly bytes: Uint8Array
  }>`
    SELECT b.sha256, b.content_type, o.bytes
    FROM blob_objects o
    INNER JOIN blobs b ON b.sha256 = o.sha256
  `.pipe(Effect.orDie)

  let copied = 0
  yield* Effect.forEach(
    rows,
    (row) =>
      Effect.gen(function*() {
        const stored = yield* blobs.put(row.bytes, row.content_type)
        const roundTrip = yield* blobs.get(stored)
        if (Option.isNone(roundTrip) || roundTrip.value.byteLength !== row.bytes.byteLength) {
          return yield* Effect.die("copied blob did not read back")
        }
        copied += 1
        if (copied % 1000 === 0) {
          yield* Console.log(`Copied ${copied} of ${rows.length}`)
        }
      }),
    { concurrency: 4 }
  )

  yield* Console.log(`Copied ${copied} blob${copied === 1 ? "" : "s"} into the bucket.`)
})

NodeRuntime.runMain(
  program.pipe(Effect.provide(Blobs.layer.pipe(Layer.provideMerge(SqlLive))))
)
