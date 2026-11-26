import { Context, Effect, Layer, Option } from "effect"
import type { ProjectAccessDenied } from "../domain/Project.js"
import { NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import { agentInstructions, integrationNoteFile } from "../domain/agentInstructions.js"
import type { LeaseWithBundle, Neighbor, WorkBundle } from "../domain/Bundle.js"
import { CheckoutLimited, type ChunkSummary } from "../domain/Chunk.js"
import { ChunkRefused } from "../domain/Problems.js"
import type { Toolchain } from "../domain/Project.js"
import { Uuid } from "../domain/Uuid.js"
import { Blobs } from "./Blobs.js"
import { ChunksRepo } from "./ChunksRepo.js"

type BundleRow = {
  readonly id: string
  readonly project_id: string
  readonly project_slug: string
  readonly binary_id: string
  readonly name: string
  readonly address: string | number | bigint
  readonly size: number
  readonly state: ChunkSummary["state"]
  readonly lease_user_id: string | null
  readonly lease_token: string | null
  readonly lease_expires_at: Date | string | null
  readonly hold_started_at: Date | string | null
  readonly language_override: string | null
  readonly bytes_sha256: Uint8Array
  readonly pseudocode_sha256: Uint8Array
  readonly disassembly_sha256: Uint8Array
  readonly headers_sha256: Uint8Array | null
  readonly type_revision: number | null
  readonly best_attempt_id: string | null
  readonly arch: string
  readonly language: string
  readonly toolchain: Toolchain
  readonly lease_hours: number
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex")

const utf8 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("utf8")

export class WorkBundles extends Context.Service<
  WorkBundles,
  {
    readonly getForLeaseHolder: (
      projectSlug: string,
      chunkId: Uuid,
      userId: Uuid
    ) => Effect.Effect<WorkBundle, NotFound | ChunkRefused>
    readonly checkoutWithBundle: (
      projectSlug: string,
      chunkId: Uuid,
      userId: Uuid
    ) => Effect.Effect<LeaseWithBundle, NotFound | ChunkRefused | CheckoutLimited | ProjectAccessDenied>
  }
>()("rehydra/services/WorkBundles") {
  static readonly layer = Layer.effect(
    WorkBundles,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const blobs = yield* Blobs
      const chunks = yield* ChunksRepo

      const loadRow = Effect.fn("WorkBundles.loadRow")(
        function*(projectSlug: string, chunkId: Uuid) {
          const rows = yield* sql<BundleRow>`
            SELECT
              c.id,
              c.project_id,
              p.slug AS project_slug,
              c.binary_id,
              c.name,
              c.address,
              c.size,
              c.state,
              c.lease_user_id,
              c.lease_token,
              c.lease_expires_at,
              c.hold_started_at,
              c.language_override,
              c.bytes_sha256,
              c.pseudocode_sha256,
              c.disassembly_sha256,
              tr.headers_sha256,
              tr.revision AS type_revision,
              c.best_attempt_id,
              b.arch,
              p.language,
              p.toolchain,
              p.lease_hours
            FROM chunks c
            INNER JOIN projects p ON p.id = c.project_id
            INNER JOIN binaries b ON b.id = c.binary_id
            LEFT JOIN type_revisions tr ON tr.id = c.type_revision_id
            WHERE p.slug = ${projectSlug}
              AND c.id = ${chunkId}
              AND p.archived_at IS NULL
            LIMIT 1
          `.pipe(Effect.orDie)

          const row = rows[0]
          if (row === undefined) {
            return yield* new NotFound()
          }
          return row
        }
      )

      const requireBytes = Effect.fn("WorkBundles.requireBytes")(
        function*(sha256: Uint8Array) {
          const bytes = yield* blobs.get(sha256)
          if (Option.isNone(bytes)) {
            return yield* new NotFound()
          }
          return bytes.value
        }
      )

      const buildBundle = Effect.fn("WorkBundles.buildBundle")(
        function*(row: BundleRow) {
          const original = yield* requireBytes(row.bytes_sha256)
          const pseudocode = yield* requireBytes(row.pseudocode_sha256)
          const disassembly = yield* requireBytes(row.disassembly_sha256)

          let types = "/* no type revision */\n"
          if (row.headers_sha256 !== null) {
            const headers = yield* requireBytes(row.headers_sha256)
            types = utf8(headers)
          }

          const neighborRows = yield* sql<{
            readonly id: string
            readonly name: string
            readonly address: string | number | bigint
            readonly size: number
          }>`
            SELECT cal.id, cal.name, cal.address, cal.size
            FROM chunk_callees cc
            INNER JOIN chunks cal ON cal.id = cc.callee_id
            WHERE cc.caller_id = ${row.id}
            ORDER BY cal.address
          `.pipe(Effect.orDie)

          const neighbors: Array<Neighbor> = neighborRows.map((n) => ({
            chunkId: n.id,
            name: n.name,
            address: String(n.address),
            size: n.size
          }))

          let bestAttemptSource: string | undefined
          if (row.best_attempt_id !== null) {
            const attempts = yield* sql<{ readonly source_sha256: Uint8Array }>`
              SELECT source_sha256 FROM attempts WHERE id = ${row.best_attempt_id} LIMIT 1
            `.pipe(Effect.orDie)
            const attempt = attempts[0]
            if (attempt !== undefined) {
              const sourceBytes = yield* blobs.get(attempt.source_sha256)
              if (Option.isSome(sourceBytes)) {
                bestAttemptSource = utf8(sourceBytes.value)
              }
            }
          }

          const noteRows = yield* sql<{ readonly detail: string }>`
            SELECT iu.detail
            FROM chunks c
            INNER JOIN matches m ON m.chunk_id = c.id
            INNER JOIN integration_units iu ON iu.chunk_id = c.id
            INNER JOIN integrations i ON i.id = iu.integration_id
            WHERE c.id = ${row.id}
              AND c.state = 'stale'
              AND c.current_match_id IS NULL
              AND iu.passed = false
              AND m.invalidated_reason = 'integration build'
              AND m.invalidated_at IS NOT NULL
              AND m.invalidated_at = (
                SELECT MAX(m2.invalidated_at)
                FROM matches m2
                WHERE m2.chunk_id = c.id
                  AND m2.invalidated_at IS NOT NULL
              )
            ORDER BY i.created_at DESC, i.id DESC
            LIMIT 1
          `.pipe(Effect.orDie)
          const integrationDetail = noteRows[0]?.detail
          const integrationNote =
            integrationDetail !== undefined && integrationDetail.trim().length > 0
              ? integrationNoteFile(integrationDetail)
              : undefined

          const language = row.language_override ?? row.language

          return {
            meta: {
              chunkId: row.id,
              projectSlug: row.project_slug,
              name: row.name,
              address: String(row.address),
              size: row.size,
              arch: row.arch,
              language,
              toolchain: row.toolchain,
              bytesSha256: hex(row.bytes_sha256),
              typeRevision: row.type_revision ?? 0
            },
            originalBytesBase64: Buffer.from(original).toString("base64"),
            pseudocode: utf8(pseudocode),
            disassembly: utf8(disassembly),
            types,
            neighbors,
            ...(bestAttemptSource !== undefined ? { bestAttemptSource } : {}),
            ...(integrationNote !== undefined ? { integrationNote } : {}),
            agentInstructions: agentInstructions({
              language,
              hasAttempt: bestAttemptSource !== undefined,
              hasIntegrationNote: integrationNote !== undefined
            })
          } satisfies WorkBundle
        }
      )

      const getForLeaseHolder = Effect.fn("WorkBundles.getForLeaseHolder")(
        function*(projectSlug: string, chunkId: Uuid, userId: Uuid) {
          const row = yield* loadRow(projectSlug, chunkId)
          const holds = yield* sql<{ readonly ok: number }>`
            SELECT 1 AS ok
            FROM chunks c
            WHERE c.id = ${row.id}
              AND c.lease_user_id = ${userId}
              AND c.state IN ('leased', 'validating')
            UNION ALL
            SELECT 1
            FROM chunk_leases cl
            INNER JOIN chunks c ON c.id = cl.chunk_id
            WHERE cl.chunk_id = ${row.id}
              AND cl.user_id = ${userId}
              AND cl.released_at IS NULL
              AND c.state IN ('leased', 'validating')
            LIMIT 1
          `.pipe(Effect.orDie)
          if (holds[0] === undefined) {
            return yield* new ChunkRefused({
              reason: "lease_gone",
              detail: "You do not hold this chunk. Its lease expired, was released, or was cleared."
            })
          }
          return yield* buildBundle(row)
        }
      )

      const checkoutWithBundle = Effect.fn("WorkBundles.checkoutWithBundle")(
        function*(projectSlug: string, chunkId: Uuid, userId: Uuid) {
          const lease = yield* chunks.checkout(projectSlug, chunkId, userId)
          const row = yield* loadRow(projectSlug, chunkId)
          const bundle = yield* buildBundle(row)
          return {
            chunk: lease.chunk,
            leaseToken: lease.leaseToken,
            leaseExpiresAt: lease.leaseExpiresAt,
            holdStartedAt: lease.holdStartedAt,
            bundle
          } satisfies LeaseWithBundle
        }
      )

      return WorkBundles.of({
        getForLeaseHolder,
        checkoutWithBundle
      })
    })
  )
}
