import { randomUUID } from "node:crypto"
import { Context, Effect, Layer, Option } from "effect"
import { Forbidden, NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import type { ChunkSummary } from "../domain/Chunk.js"
import type { FusePayload } from "../domain/Types.js"
import { InvalidRequest, ProjectRefused } from "../domain/Problems.js"
import { Uuid } from "../domain/Uuid.js"
import { Activity } from "./Activity.js"
import { Blobs } from "./Blobs.js"
import { ProjectAuth } from "./ProjectAuth.js"
import { ProjectChunkStats } from "./ProjectChunkStats.js"

type MemberRow = {
  readonly id: string
  readonly binary_id: string
  readonly name: string
  readonly address: string | number | bigint
  readonly size: number
  readonly state: string
  readonly bytes_sha256: Uint8Array
  readonly pseudocode_sha256: Uint8Array
  readonly disassembly_sha256: Uint8Array
  readonly type_revision_id: string | null
  readonly fuse_parent_id: string | null
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

export class FuseRepo extends Context.Service<
  FuseRepo,
  {
    readonly fuse: (
      projectSlug: string,
      userId: Uuid,
      payload: FusePayload
    ) => Effect.Effect<
      ChunkSummary,
      NotFound | Forbidden | ProjectRefused | InvalidRequest
    >
  }
>()("rehydra/services/FuseRepo") {
  static readonly layer = Layer.effect(
    FuseRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const blobs = yield* Blobs
      const stats = yield* ProjectChunkStats
      const auth = yield* ProjectAuth
      const activity = yield* Activity

      const fuse = Effect.fn("FuseRepo.fuse")(function*(
        projectSlug: string,
        userId: Uuid,
        payload: FusePayload
      ) {
        const { projectId } = yield* auth.requireRole(projectSlug, userId, [
          "owner",
          "maintainer"
        ])

        const ids = [...new Set(payload.chunkIds)]
        if (ids.length < 2) {
          return yield* new InvalidRequest({ reason: "too_few_chunks", detail: "Fusing needs at least two different chunks." })
        }

        return yield* sql.withTransaction(Effect.gen(function*() {
          const members = yield* sql<MemberRow>`
            SELECT
              id, binary_id, name, address, size, state,
              bytes_sha256, pseudocode_sha256, disassembly_sha256,
              type_revision_id, fuse_parent_id
            FROM chunks
            WHERE project_id = ${projectId}
              AND id = ANY(${ids}::uuid[])
            FOR UPDATE
          `

          if (members.length !== ids.length) {
            return yield* new NotFound()
          }

          const binaryId = members[0]?.binary_id
          if (binaryId === undefined) {
            return yield* new NotFound()
          }

          for (const m of members) {
            if (m.binary_id !== binaryId) {
              return yield* new InvalidRequest({
                reason: "different_programs",
                detail: "All chunks to fuse must come from the same program."
              })
            }
            if (m.fuse_parent_id !== null) {
              return yield* new ProjectRefused({ reason: "already_fused", detail: `${m.name} is already part of a fused chunk.` })
            }
            if (m.state !== "open" && m.state !== "stale" && m.state !== "matched") {
              return yield* new ProjectRefused({
                reason: "not_fusable",
                detail: `${m.name} is ${m.state}. Only open, stale, or matched chunks can be fused.`
              })
            }
            if (m.state === "matched") {
              yield* sql`
                UPDATE matches
                SET invalidated_at = now(),
                    invalidated_reason = 'fused into parent chunk'
                WHERE chunk_id = ${m.id}
                  AND invalidated_at IS NULL
              `
              yield* sql`
                UPDATE chunks
                SET current_match_id = NULL, updated_at = now()
                WHERE id = ${m.id}
              `
            }
          }

          const sorted = [...members].sort(
            (a, b) => Number(a.address) - Number(b.address)
          )
          const start = Number(sorted[0]!.address)
          const end = Math.max(
            ...sorted.map((m) => Number(m.address) + m.size)
          )
          const size = end - start
          if (size <= 0) {
            return yield* new InvalidRequest({ reason: "empty_span", detail: "The chosen chunks cover no bytes." })
          }

          const parts: Array<Buffer> = []
          const pseudoParts: Array<string> = []
          const disasmParts: Array<string> = []
          for (const m of sorted) {
            const bytes = yield* blobs.get(m.bytes_sha256)
            if (Option.isNone(bytes)) {
              return yield* new ProjectRefused({
                reason: "bytes_missing",
                detail: `The stored bytes of ${m.name} are missing, so it cannot be fused.`
              })
            }
            parts.push(Buffer.from(bytes.value))
            const pseudo = yield* blobs.get(m.pseudocode_sha256)
            if (Option.isSome(pseudo)) {
              pseudoParts.push(Buffer.from(pseudo.value).toString("utf8"))
            }
            const disasm = yield* blobs.get(m.disassembly_sha256)
            if (Option.isSome(disasm)) {
              disasmParts.push(Buffer.from(disasm.value).toString("utf8"))
            }
          }

          const bytesSha = yield* blobs.put(
            Buffer.concat(parts),
            "application/octet-stream"
          )
          const pseudoSha = yield* blobs.put(
            Buffer.from(pseudoParts.join("\n\n"), "utf8"),
            "text/x-c"
          )
          const disasmSha = yield* blobs.put(
            Buffer.from(disasmParts.join("\n\n"), "utf8"),
            "text/x-asm"
          )

          const name =
            payload.name?.trim() ||
            `fuse_${sorted.map((m) => m.name).join("_")}`.slice(0, 120)
          const parentId = randomUUID()
          const typeRevisionId = sorted[0]?.type_revision_id ?? null

          // Park the parent on a free sentinel range, attach members (they leave
          // the overlap set), then move the parent onto the covering range.
          const sentinel = yield* sql<{ readonly next_addr: string | number | bigint }>`
            SELECT COALESCE(MAX(address + size), 0) AS next_addr
            FROM chunks
            WHERE binary_id = ${binaryId}
          `
          const parkAt = Number(sentinel[0]?.next_addr ?? 0)

          yield* sql`
            INSERT INTO chunks (
              id, project_id, binary_id, name, address, size,
              bytes_sha256, pseudocode_sha256, disassembly_sha256,
              type_revision_id, state
            ) VALUES (
              ${parentId},
              ${projectId},
              ${binaryId},
              ${name},
              ${parkAt},
              ${1},
              ${bytesSha},
              ${pseudoSha},
              ${disasmSha},
              ${typeRevisionId},
              ${"open"}
            )
          `

          for (const m of sorted) {
            yield* sql`
              UPDATE chunks
              SET
                fuse_parent_id = ${parentId},
                state = 'blocked',
                lease_user_id = NULL,
                lease_token = NULL,
                lease_expires_at = NULL,
                hold_started_at = NULL,
                updated_at = now()
              WHERE id = ${m.id}
            `
          }

          const parents = yield* sql<{
            readonly id: string
            readonly project_id: string
            readonly binary_id: string
            readonly name: string
            readonly address: string | number | bigint
            readonly size: number
            readonly state: ChunkSummary["state"]
            readonly lease_user_id: string | null
            readonly lease_expires_at: Date | string | null
            readonly hold_started_at: Date | string | null
            readonly language_override: string | null
          }>`
            UPDATE chunks
            SET address = ${start}, size = ${size}, updated_at = now()
            WHERE id = ${parentId}
            RETURNING
              id, project_id, binary_id, name, address, size, state,
              lease_user_id, lease_expires_at, hold_started_at, language_override
          `

          const parent = parents[0]
          if (parent === undefined) {
            return yield* Effect.die("fused parent chunk disappeared")
          }

          yield* stats.refresh(projectId)
          yield* activity.record({
            projectId,
            actorId: userId,
            kind: "fused",
            chunkId: parent.id,
            summary: `Fused ${sorted.map((m) => m.name).join(", ")} into ${name}`
          })

          return {
            id: parent.id,
            projectId: parent.project_id,
            binaryId: parent.binary_id,
            name: parent.name,
            address: String(parent.address),
            size: parent.size,
            state: parent.state,
            ...(parent.lease_user_id !== null
              ? { leaseUserId: parent.lease_user_id }
              : {}),
            leaseCount: 0,
            // A new fused parent has no inline-assembly opt-in and no match yet.
            allowInlineAsm: false,
            matchUsesInlineAsm: false,
            ...(parent.lease_expires_at !== null
              ? { leaseExpiresAt: toIso(parent.lease_expires_at) }
              : {}),
            ...(parent.hold_started_at !== null
              ? { holdStartedAt: toIso(parent.hold_started_at) }
              : {}),
            ...(parent.language_override !== null
              ? { languageOverride: parent.language_override }
              : {})
          } satisfies ChunkSummary
        })).pipe(Effect.catchTag("SqlError", (e) => Effect.die(e)))
      })

      return FuseRepo.of({ fuse })
    })
  )
}
