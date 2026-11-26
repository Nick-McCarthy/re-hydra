import { Context, Effect, Layer, Schema } from "effect"
import { Forbidden, NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import { CheckoutLimited } from "../domain/Chunk.js"
import type { ChunkSummary, LeaseResponse, SetChunkLanguage } from "../domain/Chunk.js"
import { likeContains } from "../domain/Directory.js"
import { ChunkRefused, chunkChanged } from "../domain/Problems.js"
import { explainChunkRefusal } from "./chunkRefusals.js"
import { Uuid } from "../domain/Uuid.js"
import { Activity } from "./Activity.js"
import { ProjectAuth } from "./ProjectAuth.js"
import type { ProjectAccessDenied } from "../domain/Project.js"
import { ChunkState } from "./ChunkState.js"
import { enqueueRecipeForChunk } from "./RecipeJobs.js"

type ChunkRow = {
  readonly id: string
  readonly project_id: string
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
  readonly lease_hours: number
  readonly lease_count: number
  readonly allow_inline_asm: boolean
  readonly match_uses_inline_asm: boolean
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const toSummary = (row: ChunkRow): ChunkSummary => ({
  id: row.id,
  projectId: row.project_id,
  binaryId: row.binary_id,
  name: row.name,
  address: String(row.address),
  size: row.size,
  state: row.state,
  ...(row.lease_user_id !== null ? { leaseUserId: row.lease_user_id } : {}),
  ...(row.lease_expires_at !== null ? { leaseExpiresAt: toIso(row.lease_expires_at) } : {}),
  ...(row.hold_started_at !== null ? { holdStartedAt: toIso(row.hold_started_at) } : {}),
  ...(row.language_override !== null ? { languageOverride: row.language_override } : {}),
  leaseCount: row.lease_count,
  allowInlineAsm: row.allow_inline_asm,
  matchUsesInlineAsm: row.match_uses_inline_asm
})

const requireLeaseFields = (row: ChunkRow): Effect.Effect<LeaseResponse, ChunkRefused> => {
  if (row.lease_token === null || row.lease_expires_at === null || row.hold_started_at === null) {
    return Effect.fail(chunkChanged())
  }
  return Effect.succeed({
    chunk: toSummary(row),
    leaseToken: row.lease_token,
    leaseExpiresAt: toIso(row.lease_expires_at),
    holdStartedAt: toIso(row.hold_started_at)
  })
}

export class ChunksRepo extends Context.Service<
  ChunksRepo,
  {
    readonly listByProjectSlug: (
      projectSlug: string,
      query: {
        readonly state?: ChunkSummary["state"] | undefined
        readonly q?: string | undefined
        readonly limit?: number | undefined
        readonly offset?: number | undefined
      }
    ) => Effect.Effect<ReadonlyArray<ChunkSummary>, NotFound>
    readonly getByProjectSlug: (
      projectSlug: string,
      chunkId: Uuid
    ) => Effect.Effect<ChunkSummary, NotFound>
    readonly checkout: (
      projectSlug: string,
      chunkId: Uuid,
      userId: Uuid
    ) => Effect.Effect<LeaseResponse, NotFound | ChunkRefused | CheckoutLimited | ProjectAccessDenied>
    readonly release: (
      projectSlug: string,
      chunkId: Uuid,
      userId: Uuid,
      leaseToken: Uuid
    ) => Effect.Effect<ChunkSummary, NotFound | ChunkRefused>
    readonly heartbeat: (
      projectSlug: string,
      chunkId: Uuid,
      userId: Uuid,
      leaseToken: Uuid
    ) => Effect.Effect<LeaseResponse, NotFound | ChunkRefused | ProjectAccessDenied>
    readonly setInlineAsm: (
      projectSlug: string,
      chunkId: Uuid,
      userId: Uuid,
      allow: boolean
    ) => Effect.Effect<ChunkSummary, NotFound | Forbidden | ChunkRefused>
    readonly clearLease: (
      projectSlug: string,
      chunkId: Uuid,
      userId: Uuid
    ) => Effect.Effect<ChunkSummary, NotFound | Forbidden | ChunkRefused>
    readonly setLanguage: (
      projectSlug: string,
      chunkId: Uuid,
      userId: Uuid,
      payload: SetChunkLanguage
    ) => Effect.Effect<ChunkSummary, NotFound | Forbidden | ChunkRefused>
  }
>()("rehydra/services/ChunksRepo") {
  static readonly layer = Layer.effect(
    ChunksRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const chunkState = yield* ChunkState
      const auth = yield* ProjectAuth
      const activity = yield* Activity

      const loadChunk = Effect.fn("ChunksRepo.loadChunk")(function*(
        projectSlug: string,
        chunkId: string
      ) {
        const rows = yield* sql<ChunkRow>`
          SELECT
            c.id,
            c.project_id,
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
            c.allow_inline_asm,
            COALESCE(
              (SELECT m.uses_inline_asm FROM matches m WHERE m.id = c.current_match_id),
              false
            ) AS match_uses_inline_asm,
            p.lease_hours,
            (
              (c.lease_user_id IS NOT NULL)::int
              + (
                SELECT COUNT(*)::int
                FROM chunk_leases cl
                WHERE cl.chunk_id = c.id
                  AND cl.released_at IS NULL
              )
            ) AS lease_count
          FROM chunks c
          INNER JOIN projects p ON p.id = c.project_id
          WHERE p.slug = ${projectSlug}
            AND c.id = ${chunkId}
            AND p.archived_at IS NULL
          LIMIT 1
        `.pipe(Effect.orDie)
        return rows[0]
      })

      const listByProjectSlug = Effect.fn("ChunksRepo.listByProjectSlug")(
        function*(
          projectSlug: string,
          query: {
            readonly state?: ChunkSummary["state"] | undefined
            readonly q?: string | undefined
            readonly limit?: number | undefined
            readonly offset?: number | undefined
          }
        ) {
          const projects = yield* sql<{ readonly id: string }>`
            SELECT id FROM projects
            WHERE slug = ${projectSlug} AND archived_at IS NULL
            LIMIT 1
          `.pipe(Effect.orDie)
          if (projects[0] === undefined) {
            return yield* new NotFound()
          }

          const state = query.state ?? null
          const pattern = likeContains(query.q)
          const limit = query.limit ?? null
          const offset = query.offset ?? 0

          const rows = yield* sql<ChunkRow>`
            SELECT
              c.id,
              c.project_id,
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
              c.allow_inline_asm,
              COALESCE(
                (SELECT m.uses_inline_asm FROM matches m WHERE m.id = c.current_match_id),
                false
              ) AS match_uses_inline_asm,
              p.lease_hours,
              (
                (c.lease_user_id IS NOT NULL)::int
                + (
                  SELECT COUNT(*)::int
                  FROM chunk_leases cl
                  WHERE cl.chunk_id = c.id
                    AND cl.released_at IS NULL
                )
              ) AS lease_count
            FROM chunks c
            INNER JOIN projects p ON p.id = c.project_id
            -- Filter by id, not slug, so the planner can use chunks_board_idx.
            -- By slug it scanned and sorted the whole project (audit phase 3).
            WHERE c.project_id = ${projects[0].id}
              AND c.fuse_parent_id IS NULL
              AND (${state}::text IS NULL OR c.state::text = ${state})
              AND (
                ${pattern}::text IS NULL
                OR c.name ILIKE ${pattern} ESCAPE '\\'
                OR c.address::text ILIKE ${pattern} ESCAPE '\\'
                OR ('0x' || to_hex(c.address)) ILIKE ${pattern} ESCAPE '\\'
              )
            ORDER BY c.address, c.id
            LIMIT ${limit}
            OFFSET ${offset}
          `.pipe(Effect.orDie)

          return rows.map(toSummary)
        }
      )

      const getByProjectSlug = Effect.fn("ChunksRepo.getByProjectSlug")(
        function*(projectSlug: string, chunkId: Uuid) {
          const row = yield* loadChunk(projectSlug, chunkId)
          if (row === undefined) {
            return yield* new NotFound()
          }
          return toSummary(row)
        }
      )

      const checkout = Effect.fn("ChunksRepo.checkout")(
        function*(projectSlug: string, chunkId: Uuid, userId: Uuid) {
          // Audit A-012: blocked users, and non-members on members-only projects, stop here.
          yield* auth.requireContributor(projectSlug, userId)
          const leaseToken = yield* Schema.decodeEffect(Uuid)(crypto.randomUUID()).pipe(
            Effect.orDie
          )

          const projectRows = yield* sql<{
            readonly id: string
            readonly lease_hours: number
            readonly max_concurrent_leases: number
            readonly max_held_chunks: number
          }>`
            SELECT id, lease_hours, max_concurrent_leases, max_held_chunks
            FROM projects
            WHERE slug = ${projectSlug}
              AND archived_at IS NULL
            LIMIT 1
          `.pipe(Effect.orDie)

          const project = projectRows[0]
          if (project === undefined) {
            return yield* new NotFound()
          }

          // One transaction per checkout (audit A-008, A-009). The advisory lock
          // serializes checkouts by one user on one project, so two at once
          // cannot both pass the max_held_chunks count.
          const outcome = yield* sql.withTransaction(Effect.gen(function*() {
            yield* sql`
              SELECT pg_advisory_xact_lock(hashtext(${`held:${project.id}:${userId}`}))
            `.pipe(Effect.orDie)

            const heldRows = yield* sql<{ readonly held: number }>`
              SELECT COUNT(*)::int AS held
              FROM (
                SELECT c.id
                FROM chunks c
                WHERE c.project_id = ${project.id}
                  AND c.lease_user_id = ${userId}
                  AND c.state IN ('leased', 'validating')
                  AND c.fuse_parent_id IS NULL
                UNION
                SELECT cl.chunk_id
                FROM chunk_leases cl
                INNER JOIN chunks c ON c.id = cl.chunk_id
                WHERE c.project_id = ${project.id}
                  AND cl.user_id = ${userId}
                  AND cl.released_at IS NULL
              ) held_chunks
            `.pipe(Effect.orDie)
            const held = heldRows[0]?.held ?? 0
            if (held >= project.max_held_chunks) {
              return yield* new CheckoutLimited({
                detail: `You already hold ${held} ${held === 1 ? "chunk" : "chunks"} on this project. The limit is ${project.max_held_chunks}.`
              })
            }

            const primary = yield* chunkState.claim({
              chunkId,
              projectId: project.id,
              userId,
              leaseToken,
              leaseHours: project.lease_hours
            })
            if (primary !== undefined) {
              yield* activity.record({
                projectId: primary.project_id,
                actorId: userId,
                kind: "checkout",
                chunkId: primary.id,
                summary: `Checked out ${primary.name}`
              })
              return { kind: "primary" as const }
            }

            if (project.max_concurrent_leases > 1) {
              const holder = yield* chunkState.addCompetingLease({
                chunkId,
                projectId: project.id,
                userId,
                leaseToken
              })
              if (holder !== undefined) {
                yield* activity.record({
                  projectId: holder.project_id,
                  actorId: userId,
                  kind: "checkout",
                  chunkId: holder.chunk_id,
                  summary: `Checked out ${holder.name}`
                })
                return { kind: "extra" as const, holder }
              }
            }

            return { kind: "none" as const }
          })).pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))

          if (outcome.kind === "primary") {
            const row = yield* loadChunk(projectSlug, chunkId)
            if (row === undefined) {
              return yield* chunkChanged()
            }
            return yield* requireLeaseFields(row)
          }

          if (outcome.kind === "extra") {
            const row = yield* loadChunk(projectSlug, chunkId)
            if (row === undefined) {
              return yield* chunkChanged()
            }
            return {
              chunk: toSummary(row),
              leaseToken: outcome.holder.lease_token,
              leaseExpiresAt: toIso(outcome.holder.lease_expires_at),
              holdStartedAt: toIso(outcome.holder.hold_started_at)
            } satisfies LeaseResponse
          }

          return yield* explainChunkRefusal(sql, { projectSlug, chunkId, userId, purpose: "checkout" })
        }
      )

      const release = Effect.fn("ChunksRepo.release")(
        function*(projectSlug: string, chunkId: Uuid, userId: Uuid, leaseToken: Uuid) {
          const released = yield* sql.withTransaction(Effect.gen(function*() {
            const locked = yield* sql<{
              readonly id: string
              readonly project_id: string
              readonly name: string
              readonly state: string
              readonly lease_user_id: string | null
              readonly lease_token: string | null
            }>`
              SELECT c.id, c.project_id, c.name, c.state, c.lease_user_id, c.lease_token
              FROM chunks c
              INNER JOIN projects p ON p.id = c.project_id
              WHERE p.slug = ${projectSlug}
                AND c.id = ${chunkId}
                AND p.archived_at IS NULL
              FOR UPDATE OF c
            `.pipe(Effect.orDie)

            const chunk = locked[0]
            if (chunk === undefined) {
              return yield* new NotFound()
            }

            if (
              chunk.state === "leased" &&
              chunk.lease_user_id === userId &&
              chunk.lease_token === leaseToken
            ) {
              yield* chunkState.endPrimaryLease(chunkId, chunk.project_id)

              yield* activity.record({
                projectId: chunk.project_id,
                actorId: userId,
                kind: "release",
                chunkId: chunk.id,
                summary: `Released ${chunk.name}`
              })
              return true
            }

            const side = yield* chunkState.releaseCompetingLease({ chunkId, userId, leaseToken })

            if (!side) {
              return false
            }

            yield* activity.record({
              projectId: chunk.project_id,
              actorId: userId,
              kind: "release",
              chunkId: chunk.id,
              summary: `Released ${chunk.name}`
            })
            return true
          })).pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))

          if (!released) {
            return yield* explainChunkRefusal(sql, { projectSlug, chunkId, userId, purpose: "lease", leaseToken })
          }

          const row = yield* loadChunk(projectSlug, chunkId)
          if (row === undefined) {
            return yield* new NotFound()
          }
          return toSummary(row)
        }
      )

      const heartbeat = Effect.fn("ChunksRepo.heartbeat")(
        function*(projectSlug: string, chunkId: Uuid, userId: Uuid, leaseToken: Uuid) {
          yield* auth.requireContributor(projectSlug, userId)
          const extended = yield* chunkState.extendLease({ chunkId, projectSlug, userId, leaseToken })

          if (extended) {
            const row = yield* loadChunk(projectSlug, chunkId)
            if (row === undefined) {
              return yield* chunkChanged()
            }
            return yield* requireLeaseFields(row)
          }

          const holder = yield* chunkState.extendCompetingLease({ chunkId, projectSlug, userId, leaseToken })
          if (holder === undefined) {
            return yield* explainChunkRefusal(sql, { projectSlug, chunkId, userId, purpose: "lease", leaseToken })
          }

          const row = yield* loadChunk(projectSlug, chunkId)
          if (row === undefined) {
            return yield* chunkChanged()
          }
          return {
            chunk: toSummary(row),
            leaseToken: holder.lease_token,
            leaseExpiresAt: toIso(holder.lease_expires_at),
            holdStartedAt: toIso(holder.hold_started_at)
          } satisfies LeaseResponse
        }
      )

      const clearLease = Effect.fn("ChunksRepo.clearLease")(function*(
        projectSlug: string,
        chunkId: Uuid,
        userId: Uuid
      ) {
        yield* auth.requireRole(projectSlug, userId, ["owner", "maintainer"])

        const cleared = yield* sql.withTransaction(Effect.gen(function*() {
          const locked = yield* sql<{
            readonly id: string
            readonly project_id: string
            readonly name: string
            readonly state: string
          }>`
            SELECT c.id, c.project_id, c.name, c.state
            FROM chunks c
            INNER JOIN projects p ON p.id = c.project_id
            WHERE p.slug = ${projectSlug}
              AND c.id = ${chunkId}
              AND p.archived_at IS NULL
            FOR UPDATE OF c
          `.pipe(Effect.orDie)

          const chunk = locked[0]
          if (chunk === undefined) {
            return yield* new NotFound()
          }
          if (chunk.state !== "leased") {
            return yield* new ChunkRefused({
              reason: "not_leased",
              detail: chunk.state === "validating"
                ? "A submission for this chunk is being checked. Clear the lease after its result."
                : "This chunk has no lease to clear."
            })
          }

          yield* chunkState.returnToPool(chunkId, chunk.project_id)
          yield* activity.record({
            projectId: chunk.project_id,
            actorId: userId,
            kind: "lease_cleared",
            chunkId: chunk.id,
            summary: `Cleared the lease on ${chunk.name}`
          })
          return true
        })).pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))

        if (!cleared) {
          return yield* chunkChanged()
        }
        const row = yield* loadChunk(projectSlug, chunkId)
        if (row === undefined) {
          return yield* new NotFound()
        }
        return toSummary(row)
      })

      /**
       * Audit A-032. Owners and maintainers decide per chunk whether matchd
       * accepts inline assembly. Turning it off also invalidates a current
       * match that used it, so the chunk goes back to the pool as stale.
       */
      const setInlineAsm = Effect.fn("ChunksRepo.setInlineAsm")(function*(
        projectSlug: string,
        chunkId: Uuid,
        userId: Uuid,
        allow: boolean
      ) {
        yield* auth.requireRole(projectSlug, userId, ["owner", "maintainer"])
        const existing = yield* loadChunk(projectSlug, chunkId)
        if (existing === undefined) return yield* new NotFound()
        if (existing.allow_inline_asm === allow) return toSummary(existing)

        yield* sql.withTransaction(Effect.gen(function*() {
          const updated = yield* sql<{ readonly id: string }>`
            UPDATE chunks
            SET allow_inline_asm = ${allow}, updated_at = now()
            WHERE id = ${chunkId}
              AND project_id = ${existing.project_id}
              AND fuse_parent_id IS NULL
            RETURNING id
          `
          if (updated[0] === undefined) return
          yield* activity.record({
            projectId: existing.project_id,
            actorId: userId,
            kind: "settings_changed",
            chunkId,
            summary: allow
              ? `Allowed inline assembly for ${existing.name}`
              : `Disallowed inline assembly for ${existing.name}`
          })
          if (allow) return

          const wentStale = yield* chunkState.goStale({
            chunkId,
            projectId: existing.project_id,
            reason: "inline assembly disallowed",
            onlyInlineAsm: true
          })
          if (!wentStale) return
          yield* activity.record({
            projectId: existing.project_id,
            actorId: userId,
            kind: "became_stale",
            chunkId,
            summary: `${existing.name} went stale: its match used inline assembly`
          })
        })).pipe(Effect.orDie)

        const row = yield* loadChunk(projectSlug, chunkId)
        if (row === undefined) return yield* new NotFound()
        return toSummary(row)
      })

      const setLanguage = Effect.fn("ChunksRepo.setLanguage")(function*(
        projectSlug: string,
        chunkId: Uuid,
        userId: Uuid,
        payload: SetChunkLanguage
      ) {
        yield* auth.requireRole(projectSlug, userId, ["owner", "maintainer"])
        const existing = yield* loadChunk(projectSlug, chunkId)
        if (existing === undefined) return yield* new NotFound()

        const next = payload.language
        const current = existing.language_override
        if (next === current) return toSummary(existing)

        yield* sql.withTransaction(Effect.gen(function*() {
          const updated = yield* sql<{ readonly id: string }>`
            UPDATE chunks
            SET
              language_override = ${next},
              updated_at = now()
            WHERE id = ${chunkId}
              AND project_id = ${existing.project_id}
              AND fuse_parent_id IS NULL
            RETURNING id
          `
          if (updated[0] === undefined) return
          const label = next === null ? "the project language" : next
          yield* activity.record({
            projectId: existing.project_id,
            actorId: userId,
            kind: "settings_changed",
            chunkId,
            summary: `Set ${existing.name} language to ${label}`
          })
          yield* enqueueRecipeForChunk(sql, chunkId)
        })).pipe(Effect.orDie)

        const row = yield* loadChunk(projectSlug, chunkId)
        if (row === undefined) return yield* new NotFound()
        if (row.language_override !== next && !(row.language_override === null && next === null)) {
          return yield* chunkChanged()
        }
        return toSummary(row)
      })

      return ChunksRepo.of({
        listByProjectSlug,
        getByProjectSlug,
        checkout,
        release,
        heartbeat,
        clearLease,
        setLanguage,
        setInlineAsm
      })
    })
  )
}

export const ChunksRepoLive = ChunksRepo.layer
