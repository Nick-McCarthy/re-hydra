import { createHash, randomUUID } from "node:crypto"
import { Context, Effect, Layer } from "effect"
import { Forbidden, NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import { ImportRejected, type GhidraExportPayload, type ImportResult } from "../domain/Import.js"
import { Uuid } from "../domain/Uuid.js"
import { Activity } from "./Activity.js"
import { Blobs } from "./Blobs.js"
import { MalwareHashes } from "./MalwareHashes.js"
import { ProjectChunkStats } from "./ProjectChunkStats.js"

const reject = (detail: string) => new ImportRejected({ detail })

const parseAddress = (value: string): Effect.Effect<bigint, ImportRejected> => {
  const trimmed = value.trim().toLowerCase()
  try {
    if (trimmed.startsWith("0x")) {
      return Effect.succeed(BigInt(trimmed))
    }
    return Effect.succeed(BigInt(trimmed))
  } catch {
    return Effect.fail(reject(`Address "${value}" is not a number.`))
  }
}

const parseHexSha256 = (hex: string): Effect.Effect<Buffer, ImportRejected> => {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    return Effect.fail(reject("binarySha256 has to be 64 hexadecimal characters."))
  }
  return Effect.succeed(Buffer.from(hex, "hex"))
}

const decodeBase64 = (value: string): Effect.Effect<Buffer, ImportRejected> => {
  try {
    const buf = Buffer.from(value, "base64")
    if (buf.byteLength === 0) {
      return Effect.fail(reject("A block of bytes decoded to nothing."))
    }
    return Effect.succeed(buf)
  } catch {
    return Effect.fail(reject("A block of bytes is not valid base64."))
  }
}

const maxInt8 = 9223372036854775807n

const hexAddress = (start: bigint): string => "0x" + start.toString(16)

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && Buffer.from(left).equals(Buffer.from(right))

type RangeSpan = {
  readonly name: string
  readonly start: bigint
  readonly end: bigint
  readonly where: "export" | "project"
}

const spanLabel = (span: RangeSpan): string => {
  const bytes = span.end - span.start
  const place = span.where === "project" ? ", already on this project" : ""
  const unit = bytes === 1n ? "byte" : "bytes"
  return `${span.name} at ${hexAddress(span.start)} (${bytes} ${unit}${place})`
}

const describeOverlaps = (spans: ReadonlyArray<RangeSpan>): string | null => {
  const ordered = [...spans].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  const lines: Array<string> = []
  let total = 0
  let touchesProject = false
  for (let i = 0; i < ordered.length; i++) {
    const left = ordered[i]!
    for (let k = i + 1; k < ordered.length && ordered[k]!.start < left.end; k++) {
      const right = ordered[k]!
      if (left.start === right.start && left.end === right.end && left.where !== right.where) {
        continue
      }
      total += 1
      if (left.where === "project" || right.where === "project") touchesProject = true
      if (lines.length < 8) {
        lines.push(`${spanLabel(left)} overlaps ${spanLabel(right)}.`)
      }
    }
  }
  if (total === 0) return null
  const more = total > lines.length ? `\n${total - lines.length} more overlapping pairs.` : ""
  const why = touchesProject
    ? "The board keeps one range per stretch of bytes, including functions already on this project."
    : "The board keeps one range per stretch of bytes. If an entry point sits inside the function body, re-run ExportReHydra so the address is the start of the body."
  return lines.join("\n") + more + "\n" + why
}

export class ImportsRepo extends Context.Service<
  ImportsRepo,
  {
    readonly importExport: (
      projectSlug: string,
      userId: Uuid,
      payload: GhidraExportPayload,
      rightsConfirmed: boolean
    ) => Effect.Effect<ImportResult, NotFound | Forbidden | ImportRejected>
  }
>()("rehydra/services/ImportsRepo") {
  static readonly layer = Layer.effect(
    ImportsRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const stats = yield* ProjectChunkStats
      const blobs = yield* Blobs
      const activity = yield* Activity
      const malware = yield* MalwareHashes

      const importExport = Effect.fn("ImportsRepo.importExport")(
        function*(
          projectSlug: string,
          userId: Uuid,
          payload: GhidraExportPayload,
          rightsConfirmed: boolean
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
          // Content policy 2.3: every import carries the importer's confirmation.
          if (!rightsConfirmed) {
            return yield* reject(
              "Confirm that you own a copy of this program, that the export follows the content policy, " +
                "and that function bytes and disassembly will be shown to contributors and names to everyone " +
                "(rightsConfirmed=true)."
            )
          }

          // Content policy 2.2: no whole programs. Checked before anything is
          // stored, so the bytes never reach the blob store or the saved export.
          if (payload.binaryBase64 !== undefined) {
            return yield* reject(
              "Remove binaryBase64: re-hydra does not store whole programs. Function bytes are enough for matching, " +
                "and ExportReHydra never includes it."
            )
          }

          const binarySha = yield* parseHexSha256(payload.binarySha256)

          // Content policy 4.3: a program on the known-malware list is refused
          // before anything is stored. The attempt is recorded for the admins.
          const programName = payload.name?.trim() || null
          if (yield* malware.checkImport(binarySha, { userId, projectId: project.id, programName })) {
            return yield* reject(
              "This program's SHA-256 is on a public list of known malware (MalwareBazaar), and the content policy " +
                "(4.3) does not allow malware on re-hydra. The site admins have been told. If you think this is a " +
                "mistake, they can clear it after a look; nothing from this export was stored."
            )
          }
          const exportJson = Buffer.from(JSON.stringify(payload), "utf8")
          const exportSha = yield* blobs.put(exportJson, "application/json")

          const headersBytes = Buffer.from(payload.types, "utf8")
          const headersSha = yield* blobs.put(headersBytes, "text/x-c")

          // Only the program's hash is kept: a placeholder blob row, no bytes.
          yield* sql`
            INSERT INTO blobs (sha256, size_bytes, content_type)
            VALUES (${binarySha}, ${0}, ${"application/octet-stream"})
            ON CONFLICT DO NOTHING
          `.pipe(Effect.orDie)

          return yield* sql.withTransaction(Effect.gen(function*() {
            const importId = randomUUID()
            yield* sql`
              INSERT INTO imports (
                id, project_id, export_sha256, state, created_by, rights_confirmed_at, rights_confirmed_by
              ) VALUES (
                ${importId}, ${project.id}, ${exportSha}, ${"parsing"}, ${userId}, now(), ${userId}
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
              return yield* Effect.die("INSERT INTO binaries returned no row")
            }

            yield* sql`
              UPDATE imports SET binary_id = ${binaryId} WHERE id = ${importId}
            `

            // Older exports have no symbol list; keep whatever an earlier import stored.
            if (payload.symbols !== undefined) {
              const unique = new Map<string, { name: string; address: string; kind: string }>()
              for (const symbol of payload.symbols) {
                const address = yield* parseAddress(symbol.address).pipe(
                  Effect.mapError(() =>
                    reject(`Symbol ${symbol.name} has address "${symbol.address}", which is not a number.`)
                  )
                )
                if (address < 0n || address > maxInt8) {
                  return yield* reject(`Symbol ${symbol.name} has address "${symbol.address}", which is out of range.`)
                }
                unique.set(`${symbol.name}@${address}`, {
                  name: symbol.name,
                  address: address.toString(),
                  kind: symbol.kind
                })
              }
              yield* sql`DELETE FROM binary_symbols WHERE binary_id = ${binaryId}`
              const rows = [...unique.values()]
              for (let start = 0; start < rows.length; start += 5_000) {
                const batch = rows.slice(start, start + 5_000)
                yield* sql`
                  INSERT INTO binary_symbols (binary_id, name, address, kind)
                  SELECT ${binaryId}, s.name, s.address, s.kind
                  FROM unnest(
                    ${batch.map((row) => row.name)}::text[],
                    ${batch.map((row) => row.address)}::bigint[],
                    ${batch.map((row) => row.kind)}::text[]
                  ) AS s(name, address, kind)
                  ON CONFLICT DO NOTHING
                `
              }
            }

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

            const occupied = yield* sql<{
              readonly id: string
              readonly name: string
              readonly address: string | number | bigint
              readonly size: number | string
              readonly state: string
              readonly bytes_sha256: Uint8Array
              readonly fuse_parent_id: string | null
            }>`
              SELECT id, name, address, size, state, bytes_sha256, fuse_parent_id
              FROM chunks
              WHERE binary_id = ${binaryId}
            `
            const byRange = new Map<string, {
              readonly id: string
              readonly name: string
              readonly state: string
              readonly bytes: Uint8Array
            }>()
            const spans: Array<RangeSpan> = []
            for (const row of occupied) {
              const start = BigInt(row.address)
              const size = BigInt(row.size)
              byRange.set(`${start.toString()}:${size.toString()}`, {
                id: row.id,
                name: row.name,
                state: row.state,
                bytes: row.bytes_sha256
              })
              if (row.fuse_parent_id === null) {
                spans.push({ name: row.name, start, end: start + size, where: "project" })
              }
            }
            for (const fn of payload.functions) {
              const start = yield* parseAddress(fn.address).pipe(
                Effect.mapError(() =>
                  reject(`Function ${fn.name} has address "${fn.address}", which is not a number.`)
                )
              )
              const end = start + BigInt(fn.size)
              if (start < 0n) {
                return yield* reject(`Function ${fn.name} has address "${fn.address}", which is negative.`)
              }
              if (end > maxInt8) {
                return yield* reject(
                  `Function ${fn.name} at ${hexAddress(start)} extends past the address range this project can store.`
                )
              }
              spans.push({ name: fn.name, start, end, where: "export" })
            }
            const overlap = describeOverlaps(spans)
            if (overlap !== null) {
              return yield* reject(overlap)
            }

            for (const fn of payload.functions) {
              const address = yield* parseAddress(fn.address)
              const addressKey = address.toString()
              const fnBytes = yield* decodeBase64(fn.bytesBase64).pipe(
                Effect.mapError(() =>
                  reject(`Function ${fn.name} has bytes that are not valid base64.`)
                )
              )
              if (fnBytes.byteLength !== fn.size) {
                return yield* reject(
                  `Function ${fn.name} says it is ${fn.size} bytes, but the decoded bytes are ${fnBytes.byteLength}.`
                )
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

              const existing = byRange.get(`${addressKey}:${fn.size}`)
              if (existing !== undefined && !sameBytes(existing.bytes, bytesSha)) {
                return yield* reject(
                  `${fn.name} at ${hexAddress(address)} (${fn.size} bytes) covers the same range as ${existing.name}, which is already on this project with different bytes.`
                )
              }

              if (existing !== undefined) {
                const chunkId = existing.id
                addressToChunkId.set(addressKey, chunkId)
                const state = existing.state
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
            Effect.catchTag("SqlError", (error) =>
              error.message.includes("chunks_no_overlap")
                ? Effect.fail(reject(
                  "Two functions cover the same bytes. The board keeps one range per stretch of bytes. If an entry point sits inside the function body, re-run ExportReHydra so the address is the start of the body."
                ))
                : Effect.die(error)
            )
          )
        }
      )

      return ImportsRepo.of({ importExport })
    })
  )
}
