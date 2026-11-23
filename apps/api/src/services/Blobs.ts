import { createHash } from "node:crypto"
import { Config, Context, Effect, Layer, Option } from "effect"
import { SqlClient } from "effect/sql"
import { getObject, hashMatches, putObject, type S3ObjectConfig } from "./s3Object.js"

const hexKey = (sha256: Uint8Array): string => Buffer.from(sha256).toString("hex")

const s3Config = Effect.gen(function*() {
  const endpoint = yield* Config.String("BLOB_S3_ENDPOINT")
  const bucket = yield* Config.String("BLOB_S3_BUCKET")
  const accessKey = yield* Config.String("BLOB_S3_ACCESS_KEY")
  const secretKey = yield* Config.Redacted("BLOB_S3_SECRET_KEY")
  const region = yield* Config.String("BLOB_S3_REGION").pipe(Config.withDefault("us-east-1"))
  return {
    endpoint,
    bucket,
    accessKey,
    secretKey,
    region
  } satisfies S3ObjectConfig
})

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
      const mode = yield* Config.String("BLOB_STORE").pipe(Config.withDefault("postgres"))
      const objects = mode === "s3" ? yield* s3Config : undefined

      const put = Effect.fn("Blobs.put")(
        function*(bytes: Uint8Array, contentType: string) {
          const sha256 = createHash("sha256").update(bytes).digest()
          yield* sql`
            INSERT INTO blobs (sha256, size_bytes, content_type)
            VALUES (${sha256}, ${bytes.byteLength}, ${contentType})
            ON CONFLICT DO NOTHING
          `
          if (objects === undefined) {
            yield* sql`
              INSERT INTO blob_objects (sha256, bytes)
              VALUES (${sha256}, ${Buffer.from(bytes)})
              ON CONFLICT DO NOTHING
            `
          } else {
            yield* putObject(objects, hexKey(sha256), bytes, contentType)
          }
          return sha256
        },
        Effect.orDie
      )

      const get = Effect.fn("Blobs.get")(
        function*(sha256: Uint8Array) {
          const bytes = objects === undefined
            ? yield* sql<{ readonly bytes: Uint8Array }>`
                SELECT bytes FROM blob_objects WHERE sha256 = ${Buffer.from(sha256)} LIMIT 1
              `.pipe(Effect.map((rows) => rows[0]?.bytes))
            : yield* getObject(objects, hexKey(sha256))
          if (bytes === undefined) return Option.none()
          if (!hashMatches(bytes, sha256)) {
            return yield* Effect.die(`blob hash mismatch for ${hexKey(sha256)}`)
          }
          return Option.some(bytes)
        },
        Effect.orDie
      )

      return Blobs.of({ put, get })
    })
  )
}
