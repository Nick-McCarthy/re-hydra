import { Schema } from "effect"
import { HttpApiSchema } from "effect/http-api"
import { Toolchain } from "./Project.js"
import { ChunkSummary } from "./Chunk.js"
import { Uuid } from "./Uuid.js"

export const Neighbor = Schema.Struct({
  chunkId: Uuid,
  name: Schema.String,
  address: Schema.String,
  size: Schema.Int.check(Schema.isGreaterThan(0))
}).annotate({ identifier: "Neighbor" })

export type Neighbor = typeof Neighbor.Type

export const WorkBundleMeta = Schema.Struct({
  chunkId: Uuid,
  projectSlug: Schema.String,
  name: Schema.String,
  address: Schema.String,
  size: Schema.Int.check(Schema.isGreaterThan(0)),
  arch: Schema.String,
  language: Schema.String,
  toolchain: Toolchain,
  bytesSha256: Schema.String,
  typeRevision: Schema.Int
}).annotate({ identifier: "WorkBundleMeta" })

export type WorkBundleMeta = typeof WorkBundleMeta.Type

export const WorkBundle = Schema.Struct({
  meta: WorkBundleMeta,
  /** Raw function bytes, base64-encoded. */
  originalBytesBase64: Schema.String,
  pseudocode: Schema.String,
  disassembly: Schema.String,
  types: Schema.String,
  neighbors: Schema.Array(Neighbor),
  /** Highest-scoring prior submission source, if any. */
  bestAttemptSource: Schema.optionalKey(Schema.String)
}).annotate({ identifier: "WorkBundle" })

export type WorkBundle = typeof WorkBundle.Type

export const LeaseWithBundle = Schema.Struct({
  chunk: ChunkSummary,
  leaseToken: Uuid,
  leaseExpiresAt: Schema.String,
  holdStartedAt: Schema.String,
  bundle: WorkBundle
}).annotate({ identifier: "LeaseWithBundle" })

export type LeaseWithBundle = typeof LeaseWithBundle.Type

export const LeaseCreatedWithBundle = LeaseWithBundle.pipe(
  HttpApiSchema.status("Created")
).annotate({
  identifier: "LeaseCreatedWithBundle"
})
