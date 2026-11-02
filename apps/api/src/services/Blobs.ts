import { createHash } from "node:crypto"
import { Context, Effect, Layer, Option } from "effect"
import { SqlClient } from "effect/sql"

export class Blobs extends Context.Service<
  Blobs,
  {
    readonly put: (
      bytes: Uint8Array,
      contentType: string
    ) => Effect.Effect<Uint8Array>
    readonly get: (sha256: Uint8Array) => Effect.Effect<Option.Option<Uint8Array>>
  }
>()("rehydra/services/Blobs") {
  static readonly layer = Layer.effect(
    Blobs,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient

      const put = Effect.fn("Blobs.put")(
        function*(bytes: Uint8Array, contentType: string) {
          const sha256 = createHash("sha256").update(bytes).digest()
          yield* sql`
            INSERT INTO blobs (sha256, size_bytes, content_type)
            VALUES (${sha256}, ${bytes.byteLength}, ${contentType})
            ON CONFLICT DO NOTHING
          `

          yield* sql`
            INSERT INTO blob_objects (sha256, bytes)
            VALUES (${sha256}, ${Buffer.from(bytes)})
            ON CONFLICT DO NOTHING
          `

          return sha256
        },
        Effect.orDie
      )

      const get = Effect.fn("Blobs.get")(
        function*(sha256: Uint8Array) {
          const rows = yield* sql<{ readonly bytes: Uint8Array }>`
            SELECT bytes FROM blob_objects WHERE sha256 = ${Buffer.from(sha256)} LIMIT 1
          `
          const row = rows[0]
          if (row === undefined) {
            return Option.none()
          }
          return Option.some(row.bytes)
        },
        Effect.orDie
      )

      return Blobs.of({ put, get })
    })
  )
}
