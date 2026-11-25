import { NodeRuntime } from "@effect/platform-node"
import { PgClient } from "@effect/sql-pg"
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { Console, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { hashPassword } from "../auth/password.js"
import { Blobs } from "../services/Blobs.js"
import { SqlLive } from "./SqlLive.js"

const seedPassword = "rehydra-dev"

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest()
const hashToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest()

const program = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const pg = yield* PgClient.PgClient

  const userId = randomUUID()
  const projectId = randomUUID()
  const binaryId = randomUUID()
  const chunkId = randomUUID()
  const typeRevisionId = randomUUID()
  const passwordHash = yield* hashPassword(seedPassword)
  const sessionToken = randomBytes(32).toString("base64url")
  const sessionHash = hashToken(sessionToken)
  const sessionExpires = new Date(Date.now() + 30 * 24 * 60 * 60_000)

  const emptyHeaders = Buffer.from("/* empty types */\n", "utf8")
  // gcc -O2 -c for an empty void function is typically a single `ret`.
  // Seed original bytes must match that so dogfood submit can hit matched.
  const fnBytes = Buffer.from([0xc3])
  const pseudocode = Buffer.from("void parse_header(void) {\n}\n", "utf8")
  const disassembly = Buffer.from("parse_header:\n  ret\n", "utf8")
  const binaryBlob = Buffer.from("fake-binary", "utf8")

  const blobs = yield* Blobs
  const headersHash = yield* blobs.put(emptyHeaders, "text/x-c")
  const bytesHash = yield* blobs.put(fnBytes, "application/octet-stream")
  const pseudoHash = yield* blobs.put(pseudocode, "text/x-c")
  const disasmHash = yield* blobs.put(disassembly, "text/x-asm")
  const binaryHash = yield* blobs.put(binaryBlob, "application/octet-stream")

  yield* sql.withTransaction(Effect.gen(function*() {
    yield* sql`
      INSERT INTO users (id, email, display_name, password_hash)
      VALUES (${userId}, ${"dev@re-hydra.local"}, ${"Dev User"}, ${passwordHash})
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
    `

    const users = yield* sql<{ readonly id: string }>`
      SELECT id FROM users WHERE email = ${"dev@re-hydra.local"} LIMIT 1
    `
    const ownerId = users[0]?.id ?? userId

    yield* sql`
      INSERT INTO sessions (user_id, token_hash, expires_at)
      VALUES (${ownerId}, ${sessionHash}, ${sessionExpires})
    `

    yield* sql`
      INSERT INTO projects (
        id, slug, name, description, home_region, language, toolchain, created_by
      ) VALUES (
        ${projectId},
        ${"demo"},
        ${"Demo binary"},
        ${"Seed project for local API development"},
        ${"local"},
        ${"c"},
        ${pg.json({
          compiler: "gcc",
          version: "4.8.5",
          flags: ["-O2"],
          image: "ghcr.io/re-hydra/gcc:4.8.5@sha256:dev"
        })},
        ${ownerId}
      )
      ON CONFLICT (slug) DO NOTHING
    `

    const projects = yield* sql<{ readonly id: string }>`
      SELECT id FROM projects WHERE slug = ${"demo"} LIMIT 1
    `
    const liveProjectId = projects[0]?.id ?? projectId

    yield* sql`
      INSERT INTO project_members (project_id, user_id, role)
      VALUES (${liveProjectId}, ${ownerId}, ${"owner"})
      ON CONFLICT DO NOTHING
    `

    yield* sql`
      INSERT INTO binaries (id, project_id, sha256, arch, name)
      VALUES (${binaryId}, ${liveProjectId}, ${binaryHash}, ${"x86_64"}, ${"demo.bin"})
      ON CONFLICT (project_id, sha256) DO NOTHING
    `

    const binaries = yield* sql<{ readonly id: string }>`
      SELECT id FROM binaries WHERE project_id = ${liveProjectId} LIMIT 1
    `
    const liveBinaryId = binaries[0]?.id ?? binaryId

    yield* sql`
      INSERT INTO type_revisions (id, project_id, revision, headers_sha256, created_by)
      VALUES (${typeRevisionId}, ${liveProjectId}, ${1}, ${headersHash}, ${ownerId})
      ON CONFLICT (project_id, revision) DO NOTHING
    `

    const revisions = yield* sql<{ readonly id: string }>`
      SELECT id FROM type_revisions
      WHERE project_id = ${liveProjectId} AND revision = 1
      LIMIT 1
    `
    const liveRevisionId = revisions[0]?.id ?? typeRevisionId

    yield* sql`
      INSERT INTO chunks (
        id, project_id, binary_id, name, address, size,
        bytes_sha256, pseudocode_sha256, disassembly_sha256,
        type_revision_id, state
      ) VALUES (
        ${chunkId},
        ${liveProjectId},
        ${liveBinaryId},
        ${"parse_header"},
        ${0x401000},
        ${fnBytes.length},
        ${bytesHash},
        ${pseudoHash},
        ${disasmHash},
        ${liveRevisionId},
        ${"open"}
      )
      ON CONFLICT DO NOTHING
    `

    yield* sql`
      INSERT INTO project_chunk_stats (
        project_id, open_count, total_count
      ) VALUES (${liveProjectId}, ${1}, ${1})
      ON CONFLICT (project_id) DO UPDATE SET
        open_count = EXCLUDED.open_count,
        total_count = EXCLUDED.total_count,
        updated_at = now()
    `
  }))

  const chunks = yield* sql<{ readonly id: string }>`
    SELECT id FROM chunks
    WHERE project_id = (SELECT id FROM projects WHERE slug = ${"demo"})
      AND name = ${"parse_header"}
    LIMIT 1
  `

  const liveChunkId = chunks[0]?.id
  const owners = yield* sql<{ readonly id: string }>`
    SELECT id FROM users WHERE email = ${"dev@re-hydra.local"} LIMIT 1
  `
  const liveUserId = owners[0]?.id
  if (liveUserId !== undefined) {
    yield* seedSampleProject(sql, pg, liveUserId)
    yield* seedLinkProject(sql, pg, liveUserId)
  }

  yield* Console.log("Seed complete.")
  yield* Console.log(`User:     ${liveUserId}`)
  yield* Console.log(`Sign in:  dev@re-hydra.local / ${seedPassword}`)
  yield* Console.log(`Session:  Authorization: Bearer ${sessionToken}`)
  yield* Console.log(`Chunk:   ${liveChunkId}`)
  yield* Console.log(`GET      /v1/auth/me`)
  yield* Console.log(`GET      /v1/projects/demo/chunks/${liveChunkId}`)
  yield* Console.log(`POST     /v1/projects/demo/chunks/${liveChunkId}/checkout`)
  yield* Console.log("Sample:  project slug `sample` (gcc -O2 functions, neighbors, Header)")
  yield* Console.log("Link:    project slug `link` (fixed-address leaf/caller, decoy reopens)")
}).pipe(Effect.provide(Blobs.layer.pipe(Layer.provideMerge(SqlLive))))

type SampleFunction = {
  readonly name: string
  readonly address: string
  readonly bytesBase64: string
  readonly pseudocode: string
  readonly disassembly: string
  readonly callees?: ReadonlyArray<string>
  readonly typesUsed?: ReadonlyArray<string>
}

type SampleExport = {
  readonly arch: string
  readonly name: string
  readonly types: string
  readonly toolchain: {
    readonly compiler: string
    readonly version: string
    readonly flags: ReadonlyArray<string>
    readonly image: string
  }
  readonly binarySha256: string
  readonly functions: ReadonlyArray<SampleFunction>
}

const seedLinkProject = (
  sql: SqlClient.SqlClient,
  pg: PgClient.PgClient,
  ownerId: string
) =>
  seedExportProject(sql, pg, ownerId, {
    slug: "link",
    name: "Linked image",
    description:
      "leaf and caller were linked at fixed addresses. decoy matches in isolation and is reopened by the integration build.",
    exportPath: "../../../../fixtures/link/export.json",
    presentLog: "Link project already present."
  })

const seedSampleProject = (
  sql: SqlClient.SqlClient,
  pg: PgClient.PgClient,
  ownerId: string
) =>
  seedExportProject(sql, pg, ownerId, {
    slug: "sample",
    name: "Sample object",
    description:
      "Three gcc -O2 functions with a shared Header and a real call. Built from fixtures/sample.",
    exportPath: "../../../../fixtures/sample/export.json",
    presentLog: "Sample project already present."
  })

const seedExportProject = (
  sql: SqlClient.SqlClient,
  pg: PgClient.PgClient,
  ownerId: string,
  spec: {
    readonly slug: string
    readonly name: string
    readonly description: string
    readonly exportPath: string
    readonly presentLog: string
  }
) =>
  Effect.gen(function*() {
    const existing = yield* sql<{ readonly id: string }>`
      SELECT id FROM projects WHERE slug = ${spec.slug} LIMIT 1
    `
    if (existing[0] !== undefined) {
      yield* Console.log(spec.presentLog)
      return
    }

    const samplePath = fileURLToPath(new URL(spec.exportPath, import.meta.url))
    const sample = JSON.parse(readFileSync(samplePath, "utf8")) as SampleExport
    const projectId = randomUUID()
    const binaryId = randomUUID()
    const revisionId = randomUUID()
    const headers = Buffer.from(sample.types, "utf8")
    const headersHash = sha256(headers)
    // Like a real import: only the program's hash, as a placeholder blob row.
    const binaryHash = Buffer.from(sample.binarySha256, "hex")

    const prepared = sample.functions.map((fn) => {
      const bytes = Buffer.from(fn.bytesBase64, "base64")
      const pseudocode = Buffer.from(fn.pseudocode, "utf8")
      const disassembly = Buffer.from(fn.disassembly, "utf8")
      return {
        fn,
        id: randomUUID(),
        address: Number(BigInt(fn.address)),
        bytes,
        pseudocode,
        disassembly,
        bytesHash: sha256(bytes),
        pseudoHash: sha256(pseudocode),
        disasmHash: sha256(disassembly)
      }
    })

    const store = yield* Blobs
    const stored: Array<{ readonly bytes: Uint8Array; readonly type: string }> = [
      { bytes: headers, type: "text/x-c" }
    ]
    for (const row of prepared) {
      stored.push(
        { bytes: row.bytes, type: "application/octet-stream" },
        { bytes: row.pseudocode, type: "text/x-c" },
        { bytes: row.disassembly, type: "text/x-asm" }
      )
    }
    for (const blob of stored) {
      yield* store.put(blob.bytes, blob.type)
    }
    yield* sql`
      INSERT INTO blobs (sha256, size_bytes, content_type)
      VALUES (${binaryHash}, ${0}, ${"application/octet-stream"})
      ON CONFLICT DO NOTHING
    `

    yield* sql.withTransaction(Effect.gen(function*() {
      yield* sql`
        INSERT INTO projects (
          id, slug, name, description, home_region, language, toolchain, created_by
        ) VALUES (
          ${projectId},
          ${spec.slug},
          ${spec.name},
          ${spec.description},
          ${"local"},
          ${"c"},
          ${pg.json(sample.toolchain)},
          ${ownerId}
        )
      `

      yield* sql`
        INSERT INTO project_members (project_id, user_id, role)
        VALUES (${projectId}, ${ownerId}, ${"owner"})
      `

      yield* sql`
        INSERT INTO binaries (id, project_id, sha256, arch, name)
        VALUES (${binaryId}, ${projectId}, ${binaryHash}, ${sample.arch}, ${sample.name})
      `

      yield* sql`
        INSERT INTO type_revisions (id, project_id, revision, headers_sha256, created_by)
        VALUES (${revisionId}, ${projectId}, ${1}, ${headersHash}, ${ownerId})
      `

      for (const row of prepared) {
        yield* sql`
          INSERT INTO chunks (
            id, project_id, binary_id, name, address, size,
            bytes_sha256, pseudocode_sha256, disassembly_sha256,
            type_revision_id, state
          ) VALUES (
            ${row.id},
            ${projectId},
            ${binaryId},
            ${row.fn.name},
            ${row.address},
            ${row.bytes.length},
            ${row.bytesHash},
            ${row.pseudoHash},
            ${row.disasmHash},
            ${revisionId},
            ${"open"}
          )
        `
      }

      const idByAddress = new Map(prepared.map((row) => [String(row.address), row.id]))
      for (const row of prepared) {
        for (const callee of row.fn.callees ?? []) {
          const calleeId = idByAddress.get(String(Number(BigInt(callee))))
          if (calleeId === undefined || calleeId === row.id) continue
          yield* sql`
            INSERT INTO chunk_callees (caller_id, callee_id)
            VALUES (${row.id}, ${calleeId})
          `
        }
        for (const typeName of row.fn.typesUsed ?? []) {
          yield* sql`
            INSERT INTO chunk_type_refs (chunk_id, type_name)
            VALUES (${row.id}, ${typeName})
          `
        }
      }

      yield* sql`
        INSERT INTO project_chunk_stats (project_id, open_count, total_count)
        VALUES (${projectId}, ${prepared.length}, ${prepared.length})
      `
    }))

    yield* Console.log(`Seeded ${prepared.length} chunks on slug ${spec.slug}`)
  })

NodeRuntime.runMain(program)
