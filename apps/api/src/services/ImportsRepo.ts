import { createHash, randomUUID } from "node:crypto"
import { Context, Effect, Layer } from "effect"
import {
  BadRequest,
  Conflict,
  Forbidden,
  NotFound
} from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import type { GhidraExportPayload, ImportResult } from "../domain/Import.js"
import { Uuid } from "../domain/Uuid.js"
import { Activity } from "./Activity.js"
import { Blobs } from "./Blobs.js"
import { ProjectChunkStats } from "./ProjectChunkStats.js"

const parseAddress = (value: string): Effect.Effect<bigint, BadRequest> => {
  const trimmed = value.trim().toLowerCase()
  try {
    if (trimmed.startsWith("0x")) {
      return Effect.succeed(BigInt(trimmed))
    }
    return Effect.succeed(BigInt(trimmed))
  } catch {
    return Effect.fail(new BadRequest())
  }
}

const parseHexSha256 = (hex: string): Effect.Effect<Buffer, BadRequest> => {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    return Effect.fail(new BadRequest())
  }
  return Effect.succeed(Buffer.from(hex, "hex"))
}

const decodeBase64 = (value: string): Effect.Effect<Buffer, BadRequest> => {
  try {
    const buf = Buffer.from(value, "base64")
    if (buf.byteLength === 0) {
      return Effect.fail(new BadRequest())
    }
    return Effect.succeed(buf)
  } catch {
    return Effect.fail(new BadRequest())
  }
}

export class ImportsRepo extends Context.Service<
  ImportsRepo,
  {
    readonly importExport: (
      projectSlug: string,
      userId: Uuid,
      payload: GhidraExportPayload
    ) => Effect.Effect<ImportResult, NotFound | Forbidden | BadRequest | Conflict>
  }
>()("rehydra/services/ImportsRepo") {
  static readonly layer = Layer.effect(
    ImportsRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const stats = yield* ProjectChunkStats
      const blobs = yield* Blobs
      const activity = yield* Activity

      const importExport = Effect.fn("ImportsRepo.importExport")(
        function*(
          projectSlug: string,
          userId: Uuid,
          payload: GhidraExportPayload
        ) {
          const projects = yield* sql<{
            readonly id: string
            readonly language: string
          }>`
            SELECT id, language
            FROM projects
            WHERE slug = ${projectSlug}
              AND archived_at IS NULL
            LIMIT 1
          `.pipe(Effect.orDie)

          const project = projects[0]
          if (project === undefined) {
            return yield* new NotFound()
          }

          const members = yield* sql<{ readonly role: string }>`
            SELECT role FROM project_members
            WHERE project_id = ${project.id} AND user_id = ${userId}
            LIMIT 1
          `.pipe(Effect.orDie)

          const role = members[0]?.role
          if (role !== "owner" && role !== "maintainer") {
            return yield* new Forbidden()
          }

          const binarySha = yield* parseHexSha256(payload.binarySha256)
          const exportJson = Buffer.from(JSON.stringify(payload), "utf8")
          const exportSha = yield* blobs.put(exportJson, "application/json")

          const headersBytes = Buffer.from(payload.types, "utf8")
          const headersSha = yield* blobs.put(headersBytes, "text/x-c")

          if (payload.binaryBase64 !== undefined) {
            const binaryBytes = yield* decodeBase64(payload.binaryBase64)
            const actual = createHash("sha256").update(binaryBytes).digest()
            if (!actual.equals(binarySha)) {
              return yield* new BadRequest()
            }
            yield* blobs.put(binaryBytes, "application/octet-stream")
          } else {
            yield* sql`
              INSERT INTO blobs (sha256, size_bytes, content_type)
              VALUES (${binarySha}, ${0}, ${"application/octet-stream"})
              ON CONFLICT DO NOTHING
            `.pipe(Effect.orDie)
          }

          return yield* sql.withTransaction(Effect.gen(function*() {
            const importId = randomUUID()
            yield* sql`
              INSERT INTO imports (
                id, project_id, export_sha256, state, created_by
              ) VALUES (
                ${importId}, ${project.id}, ${exportSha}, ${"parsing"}, ${userId}
              )
            `

            const binaryName = payload.name?.trim() || "imported.bin"
            const binaries = yield* sql<{ readonly id: string }>`
              INSERT INTO binaries (project_id, sha256, arch, name)
              VALUES (${project.id}, ${binarySha}, ${payload.arch}, ${binaryName})
              ON CONFLICT (project_id, sha256) DO UPDATE SET
                arch = EXCLUDED.arch,
                name = EXCLUDED.name
              RETURNING id
            `

            const binaryId = binaries[0]?.id
            if (binaryId === undefined) {
              return yield* new Conflict()
            }

            yield* sql`
              UPDATE imports SET binary_id = ${binaryId} WHERE id = ${importId}
            `

            const revRows = yield* sql<{ readonly revision: number }>`
              SELECT COALESCE(MAX(revision), 0) AS revision
              FROM type_revisions
              WHERE project_id = ${project.id}
            `
            const nextRevision = Number(revRows[0]?.revision ?? 0) + 1
            const typeRevisionId = randomUUID()
            yield* sql`
              INSERT INTO type_revisions (
                id, project_id, revision, headers_sha256, created_by
              ) VALUES (
                ${typeRevisionId}, ${project.id}, ${nextRevision}, ${headersSha}, ${userId}
              )
            `

            let created = 0
            let updated = 0
            const addressToChunkId = new Map<string, string>()
            const pendingCallees: Array<{
              readonly callerAddress: string
              readonly calleeAddresses: ReadonlyArray<string>
            }> = []
            const pendingTypeRefs: Array<{
              readonly chunkId: string
              readonly typeNames: ReadonlyArray<string>
            }> = []

            for (const fn of payload.functions) {
              const address = yield* parseAddress(fn.address)
              const addressKey = address.toString()
              const fnBytes = yield* decodeBase64(fn.bytesBase64)
              if (fnBytes.byteLength !== fn.size) {
                return yield* new BadRequest()
              }

              const bytesSha = yield* blobs.put(fnBytes, "application/octet-stream")
              const pseudoSha = yield* blobs.put(
                Buffer.from(fn.pseudocode, "utf8"),
                "text/x-c"
              )
              const disasmSha = yield* blobs.put(
                Buffer.from(fn.disassembly, "utf8"),
                "text/x-asm"
              )

              const existing = yield* sql<{
                readonly id: string
                readonly state: string
              }>`
                SELECT id, state
                FROM chunks
                WHERE binary_id = ${binaryId}
                  AND bytes_sha256 = ${bytesSha}
                  AND address = ${address}
                  AND size = ${fn.size}
                LIMIT 1
              `

              if (existing[0] !== undefined) {
                const chunkId = existing[0].id
                addressToChunkId.set(addressKey, chunkId)
                const state = existing[0].state
                if (state === "open" || state === "stale" || state === "blocked") {
                  yield* sql`
                    UPDATE chunks SET
                      name = ${fn.name},
                      pseudocode_sha256 = ${pseudoSha},
                      disassembly_sha256 = ${disasmSha},
                      type_revision_id = ${typeRevisionId},
                      updated_at = now()
                    WHERE id = ${chunkId}
                  `
                  updated += 1
                }
                // leased / validating / matched: keep lease & match; refresh types_used only
                pendingCallees.push({
                  callerAddress: addressKey,
                  calleeAddresses: fn.callees ?? []
                })
                pendingTypeRefs.push({
                  chunkId,
                  typeNames: fn.typesUsed ?? []
                })
                continue
              }

              const chunkId = randomUUID()
              yield* sql`
                INSERT INTO chunks (
                  id, project_id, binary_id, name, address, size,
                  bytes_sha256, pseudocode_sha256, disassembly_sha256,
                  type_revision_id, state
                ) VALUES (
                  ${chunkId},
                  ${project.id},
                  ${binaryId},
                  ${fn.name},
                  ${address},
                  ${fn.size},
                  ${bytesSha},
                  ${pseudoSha},
                  ${disasmSha},
                  ${typeRevisionId},
                  ${"open"}
                )
              `
              addressToChunkId.set(addressKey, chunkId)
              created += 1
              pendingCallees.push({
                callerAddress: addressKey,
                calleeAddresses: fn.callees ?? []
              })
              pendingTypeRefs.push({
                chunkId,
                typeNames: fn.typesUsed ?? []
              })
            }

            for (const edge of pendingCallees) {
              const callerId = addressToChunkId.get(edge.callerAddress)
              if (callerId === undefined) continue
              for (const calleeAddr of edge.calleeAddresses) {
                const calleeParsed = yield* parseAddress(calleeAddr)
                const calleeId = addressToChunkId.get(calleeParsed.toString())
                if (calleeId === undefined || calleeId === callerId) continue
                yield* sql`
                  INSERT INTO chunk_callees (caller_id, callee_id)
                  VALUES (${callerId}, ${calleeId})
                  ON CONFLICT DO NOTHING
                `
              }
            }

            for (const refs of pendingTypeRefs) {
              yield* sql`
                DELETE FROM chunk_type_refs WHERE chunk_id = ${refs.chunkId}
              `
              for (const typeName of refs.typeNames) {
                const trimmed = typeName.trim()
                if (trimmed.length === 0) continue
                yield* sql`
                  INSERT INTO chunk_type_refs (chunk_id, type_name)
                  VALUES (${refs.chunkId}, ${trimmed})
                  ON CONFLICT DO NOTHING
                `
              }
            }

            yield* stats.refresh(project.id)
            yield* activity.record({
              projectId: project.id,
              actorId: userId,
              kind: "imported",
              summary: `Imported ${payload.functions.length} functions`
            })

            const finished = yield* sql<{
              readonly created_at: Date | string
            }>`
              UPDATE imports
              SET state = ${"ready"}, finished_at = now()
              WHERE id = ${importId}
              RETURNING created_at
            `

            const createdAt = finished[0]?.created_at
            return {
              id: importId,
              projectId: project.id,
              binaryId,
              state: "ready" as const,
              functionsTotal: payload.functions.length,
              functionsCreated: created,
              functionsUpdated: updated,
              typeRevision: nextRevision,
              createdAt: createdAt instanceof Date
                ? createdAt.toISOString()
                : new Date(createdAt ?? Date.now()).toISOString()
            } satisfies ImportResult
          })).pipe(
            Effect.catchTag("SqlError", (e) => Effect.die(e))
          )
        }
      )

      return ImportsRepo.of({ importExport })
    })
  )
}
