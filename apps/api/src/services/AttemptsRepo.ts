import { PgClient } from "@effect/sql-pg"
import { Context, Effect, Layer } from "effect"
import { Conflict, NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import type { AttemptResult, AttemptSummary } from "../domain/Attempt.js"
import { Uuid } from "../domain/Uuid.js"
import { Blobs } from "./Blobs.js"
import { ProjectChunkStats } from "./ProjectChunkStats.js"

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

type LeaseRow = {
  readonly chunk_id: string
  readonly project_id: string
  readonly name: string
  readonly bytes_sha256: Uint8Array
  readonly type_revision_id: string | null
  readonly language: string
  readonly toolchain: unknown
  readonly lease_token: string
  readonly state: string
}

type AttemptRow = {
  readonly id: string
  readonly chunk_id: string
  readonly lease_token: string
  readonly score: string | number | null
  readonly matched: boolean | null
  readonly diagnostics: string | null
  readonly finished_at: Date | string | null
}

export class AttemptsRepo extends Context.Service<
  AttemptsRepo,
  {
    readonly listByChunk: (
      projectSlug: string,
      chunkId: Uuid
    ) => Effect.Effect<ReadonlyArray<AttemptSummary>, NotFound>
    readonly submit: (options: {
      readonly projectSlug: string
      readonly chunkId: Uuid
      readonly userId: Uuid
      readonly leaseToken: Uuid
      readonly source: string
    }) => Effect.Effect<AttemptResult, NotFound | Conflict>
  }
>()("rehydra/services/AttemptsRepo") {
  static readonly layer = Layer.effect(
    AttemptsRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const pg = yield* PgClient.PgClient
      const blobs = yield* Blobs
      const stats = yield* ProjectChunkStats

      const listByChunk = Effect.fn("AttemptsRepo.listByChunk")(function*(
        projectSlug: string,
        chunkId: Uuid
      ) {
        const chunks = yield* sql<{
          readonly id: string
          readonly best_attempt_id: string | null
        }>`
          SELECT c.id, c.best_attempt_id
          FROM chunks c
          INNER JOIN projects p ON p.id = c.project_id
          WHERE p.slug = ${projectSlug}
            AND c.id = ${chunkId}
            AND p.archived_at IS NULL
          LIMIT 1
        `.pipe(Effect.orDie)

        const chunk = chunks[0]
        if (chunk === undefined) {
          return yield* new NotFound()
        }

        const rows = yield* sql<{
          readonly id: string
          readonly chunk_id: string
          readonly user_id: string
          readonly display_name: string
          readonly score: string | number | null
          readonly matched: boolean | null
          readonly compiler_ok: boolean | null
          readonly diagnostics: string | null
          readonly created_at: Date | string
          readonly finished_at: Date | string | null
        }>`
          SELECT
            a.id,
            a.chunk_id,
            a.user_id,
            u.display_name,
            a.score,
            a.matched,
            a.compiler_ok,
            a.diagnostics,
            a.created_at,
            a.finished_at
          FROM attempts a
          INNER JOIN users u ON u.id = a.user_id
          WHERE a.chunk_id = ${chunkId}
          ORDER BY a.score DESC NULLS LAST, a.created_at DESC
          LIMIT 50
        `.pipe(Effect.orDie)

        return rows.map((row): AttemptSummary => ({
          id: row.id,
          chunkId: row.chunk_id,
          userId: row.user_id,
          displayName: row.display_name,
          score: row.score === null ? null : Number(row.score),
          matched: row.matched,
          compilerOk: row.compiler_ok,
          diagnostics: row.diagnostics,
          best: chunk.best_attempt_id === row.id,
          createdAt: toIso(row.created_at),
          finishedAt: row.finished_at === null ? null : toIso(row.finished_at)
        }))
      })

      const submit = Effect.fn("AttemptsRepo.submit")(function*(options: {
        readonly projectSlug: string
        readonly chunkId: Uuid
        readonly userId: Uuid
        readonly leaseToken: Uuid
        readonly source: string
      }) {
        const leaseRows = yield* sql<LeaseRow>`
          SELECT
            c.id AS chunk_id,
            c.project_id,
            c.name,
            c.bytes_sha256,
            c.type_revision_id,
            COALESCE(c.language_override, p.language) AS language,
            p.toolchain,
            c.lease_token,
            c.state
          FROM chunks c
          INNER JOIN projects p ON p.id = c.project_id
          WHERE p.slug = ${options.projectSlug}
            AND c.id = ${options.chunkId}
            AND c.lease_user_id = ${options.userId}
            AND c.lease_token = ${options.leaseToken}
            AND c.state IN ('leased', 'validating')
          LIMIT 1
        `.pipe(Effect.orDie)

        let lease = leaseRows[0]
        if (lease === undefined) {
          const displaced = yield* sql<LeaseRow>`
            WITH locked AS (
              SELECT c.id
              FROM chunks c
              INNER JOIN projects p ON p.id = c.project_id
              WHERE p.slug = ${options.projectSlug}
                AND c.id = ${options.chunkId}
                AND c.state = 'leased'
              FOR UPDATE OF c
            ),
            side AS (
              SELECT
                cl.chunk_id,
                cl.user_id,
                cl.lease_token,
                cl.lease_expires_at,
                cl.hold_started_at
              FROM chunk_leases cl
              INNER JOIN locked ON locked.id = cl.chunk_id
              WHERE cl.user_id = ${options.userId}
                AND cl.lease_token = ${options.leaseToken}
                AND cl.released_at IS NULL
            ),
            displaced_primary AS (
              INSERT INTO chunk_leases (
                chunk_id, user_id, lease_token, lease_expires_at, hold_started_at
              )
              SELECT
                c.id,
                c.lease_user_id,
                c.lease_token,
                c.lease_expires_at,
                c.hold_started_at
              FROM chunks c
              INNER JOIN side ON side.chunk_id = c.id
              WHERE c.lease_user_id IS NOT NULL
                AND c.lease_token IS NOT NULL
                AND c.lease_expires_at IS NOT NULL
                AND c.hold_started_at IS NOT NULL
                AND NOT EXISTS (
                  SELECT 1 FROM chunk_leases existing
                  WHERE existing.chunk_id = c.id
                    AND existing.user_id = c.lease_user_id
                    AND existing.released_at IS NULL
                )
              RETURNING chunk_id
            ),
            drop_side AS (
              UPDATE chunk_leases cl
              SET released_at = now()
              FROM side
              WHERE cl.chunk_id = side.chunk_id
                AND cl.lease_token = side.lease_token
                AND cl.released_at IS NULL
                AND EXISTS (SELECT 1 FROM displaced_primary)
              RETURNING cl.chunk_id
            )
            UPDATE chunks c
            SET
              state = 'validating',
              lease_user_id = side.user_id,
              lease_token = side.lease_token,
              lease_expires_at = side.lease_expires_at,
              hold_started_at = side.hold_started_at,
              updated_at = now()
            FROM side, projects p
            WHERE c.id = side.chunk_id
              AND c.project_id = p.id
              AND EXISTS (SELECT 1 FROM drop_side)
            RETURNING
              c.id AS chunk_id,
              c.project_id,
              c.name,
              c.bytes_sha256,
              c.type_revision_id,
              COALESCE(c.language_override, p.language) AS language,
              p.toolchain,
              c.lease_token,
              c.state
          `.pipe(Effect.orDie)
          lease = displaced[0]
        }
        if (lease === undefined) {
          const exists = yield* sql<{ readonly id: string }>`
            SELECT c.id
            FROM chunks c
            INNER JOIN projects p ON p.id = c.project_id
            WHERE p.slug = ${options.projectSlug}
              AND c.id = ${options.chunkId}
            LIMIT 1
          `.pipe(Effect.orDie)
          if (exists[0] === undefined) {
            return yield* new NotFound()
          }
          return yield* new Conflict()
        }

        if (lease.type_revision_id === null) {
          return yield* new Conflict()
        }

        const sourceBytes = new TextEncoder().encode(options.source)
        const sourceSha = yield* blobs.put(sourceBytes, "text/x-c")

        const existing = yield* sql<AttemptRow>`
          SELECT id, chunk_id, lease_token, score, matched, diagnostics, finished_at
          FROM attempts
          WHERE chunk_id = ${options.chunkId}
            AND lease_token = ${options.leaseToken}
            AND source_sha256 = ${sourceSha}
          LIMIT 1
        `.pipe(Effect.orDie)

        const prior = existing[0]
        if (prior !== undefined) {
          const jobs = yield* sql<{ readonly id: string }>`
            SELECT id FROM jobs
            WHERE attempt_id = ${prior.id}
            ORDER BY created_at DESC
            LIMIT 1
          `.pipe(Effect.orDie)
          return {
            attemptId: prior.id,
            chunkId: prior.chunk_id,
            jobId: jobs[0]?.id ?? prior.id,
            state: prior.finished_at === null ? ("queued" as const) : ("finished" as const),
            score: prior.score === null ? null : Number(prior.score),
            matched: prior.matched,
            diagnostics: prior.diagnostics,
            leaseToken: prior.lease_token
          } satisfies AttemptResult
        }

        const attemptRows = yield* sql<{ readonly id: string }>`
          INSERT INTO attempts (
            chunk_id, user_id, lease_token, source_sha256,
            type_revision_id, language
          ) VALUES (
            ${options.chunkId},
            ${options.userId},
            ${options.leaseToken},
            ${sourceSha},
            ${lease.type_revision_id},
            ${lease.language}
          )
          RETURNING id
        `.pipe(Effect.orDie)

        const attemptId = attemptRows[0]?.id
        if (attemptId === undefined) {
          return yield* new Conflict()
        }

        yield* sql`
          UPDATE chunks
          SET state = 'validating', updated_at = now()
          WHERE id = ${options.chunkId}
            AND lease_token = ${options.leaseToken}
            AND state IN ('leased', 'validating')
        `.pipe(Effect.orDie)

        yield* stats.refresh(lease.project_id)

        const jobRows = yield* sql<{ readonly id: string }>`
          INSERT INTO jobs (
            project_id, chunk_id, attempt_id, kind, state, priority,
            toolchain, language, entry_symbol, original_sha256, sources
          ) VALUES (
            ${lease.project_id},
            ${options.chunkId},
            ${attemptId},
            ${"interactive"},
            ${"queued"},
            ${10},
            ${pg.json(lease.toolchain)},
            ${lease.language},
            ${lease.name},
            ${lease.bytes_sha256},
            ${pg.json([{
              path: "candidate.c",
              sha256: Buffer.from(sourceSha).toString("hex")
            }])}
          )
          RETURNING id
        `.pipe(Effect.orDie)

        const jobId = jobRows[0]?.id
        if (jobId === undefined) {
          return yield* new Conflict()
        }

        return {
          attemptId,
          chunkId: options.chunkId,
          jobId,
          state: "queued" as const,
          score: null,
          matched: null,
          diagnostics: null,
          leaseToken: options.leaseToken
        } satisfies AttemptResult
      })

      return AttemptsRepo.of({ listByChunk, submit })
    })
  )
}
