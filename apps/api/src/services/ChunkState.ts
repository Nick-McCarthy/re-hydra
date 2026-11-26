import { Context, Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { ProjectChunkStats } from "./ProjectChunkStats.js"

/**
 * Every change to a chunk's state, its primary lease, its current match, or
 * its competing leases (`chunk_leases`) goes through this service (roadmap,
 * Next step 2). `chunkStateWrites.test.ts` fails on such a write anywhere
 * else.
 *
 * Rules each method keeps:
 * - It runs in the caller's transaction (the SQL client joins it), so a
 *   refusal later in the caller rolls the change back.
 * - It only acts from the states it names, and writes the whole lease column
 *   set at once, so `chunks_check1` always holds: `open`, `stale`, `matched`,
 *   and `blocked` have no holder; `leased` has holder, token, expiry, and
 *   hold start; `validating` keeps holder, token, and hold start.
 * - It recounts `project_chunk_stats` for the project it changed, so callers
 *   never do. The lease sweeper also recounts recently changed projects as a
 *   backstop for concurrent recounts (audit A-016).
 *
 * Activity events, attempts, jobs, and match rows stay with the callers.
 */
export interface ChunkRef {
  readonly id: string
  readonly project_id: string
  readonly name: string
}

export interface CompetingLease {
  readonly chunk_id: string
  readonly project_id: string
  readonly name: string
  readonly lease_token: string
  readonly lease_expires_at: Date | string
  readonly hold_started_at: Date | string
}

export class ChunkState extends Context.Service<
  ChunkState,
  {
    /** `open` or `stale` with no holder → `leased` to this user. */
    readonly claim: (input: {
      readonly chunkId: string
      readonly projectId: string
      readonly userId: string
      readonly leaseToken: string
      readonly leaseHours: number
    }) => Effect.Effect<ChunkRef | undefined>
    /** A competing lease on a chunk someone else holds, within `max_concurrent_leases`. */
    readonly addCompetingLease: (input: {
      readonly chunkId: string
      readonly projectId: string
      readonly userId: string
      readonly leaseToken: string
    }) => Effect.Effect<CompetingLease | undefined>
    /** Heartbeat on the primary lease. False when it is not this user's live lease. */
    readonly extendLease: (input: {
      readonly chunkId: string
      readonly projectSlug: string
      readonly userId: string
      readonly leaseToken: string
    }) => Effect.Effect<boolean>
    /** Heartbeat on a competing lease. */
    readonly extendCompetingLease: (input: {
      readonly chunkId: string
      readonly projectSlug: string
      readonly userId: string
      readonly leaseToken: string
    }) => Effect.Effect<CompetingLease | undefined>
    /**
     * End the primary lease of a `leased` chunk the caller has locked: the
     * oldest live competing lease takes it over, or the chunk goes back to the
     * pool.
     */
    readonly endPrimaryLease: (chunkId: string, projectId: string) => Effect.Effect<"promoted" | "returned">
    /** End one user's competing lease. */
    readonly releaseCompetingLease: (input: {
      readonly chunkId: string
      readonly userId: string
      readonly leaseToken: string
    }) => Effect.Effect<boolean>
    /** `leased` → the pool, ending every competing lease on it too (a maintainer's clear). */
    readonly returnToPool: (chunkId: string, projectId: string) => Effect.Effect<boolean>
    /**
     * End every lease one user holds, on one project or everywhere: their
     * `leased` chunks go back to the pool (with the competing leases on them)
     * and their competing leases end. `validating` chunks are left alone; a
     * caller that must not leave one checks first. Returns the projects touched.
     */
    readonly endUserLeases: (input: {
      readonly userId: string
      readonly projectId?: string
    }) => Effect.Effect<ReadonlyArray<string>>
    /**
     * Submit: `leased` → `validating` for this lease. A competing holder takes
     * the primary slot and the previous holder is parked as a competing lease.
     */
    readonly startValidating: (input: {
      readonly chunkId: string
      readonly userId: string
      readonly leaseToken: string
      readonly primary: boolean
    }) => Effect.Effect<{ readonly chunk_id: string; readonly project_id: string } | undefined>
    /** `validating` for this lease → `matched`. Ends the competing leases. */
    readonly recordMatch: (input: {
      readonly chunkId: string
      readonly projectId: string
      readonly leaseToken: string
      readonly matchId: string | null
      readonly attemptId: string
    }) => Effect.Effect<void>
    /**
     * `validating` for this lease → `leased`, with a fresh `lease_hours` window
     * that is never past `max_hold_hours` and never shorter than before (A-023).
     */
    readonly recordMiss: (input: {
      readonly chunkId: string
      readonly projectId: string
      readonly leaseToken: string
      readonly attemptId: string
    }) => Effect.Effect<void>
    /**
     * A job ended with no result: `validating` → `leased` back to its holder,
     * unless another interactive job for the chunk is still in flight (A-004).
     */
    readonly returnFromValidating: (input: {
      readonly chunkId: string
      readonly projectId: string
      readonly jobId: string
      readonly leaseToken: string | null
    }) => Effect.Effect<boolean>
    /** Sweeper backstop: `validating` chunks with no job in flight for five minutes go back to their holders. */
    readonly returnOrphanedValidating: Effect.Effect<ReadonlyArray<ChunkRef>>
    /**
     * Invalidate a match and move a `matched` chunk to `stale`. By default the
     * chunk's active match; `matchId` names one; `onlyInlineAsm` acts only when
     * the current match used inline assembly. True when the chunk went stale.
     */
    readonly goStale: (input: {
      readonly chunkId: string
      readonly projectId: string
      readonly reason: string
      readonly matchId?: string
      readonly onlyInlineAsm?: boolean
    }) => Effect.Effect<boolean>
    /**
     * `goStale` for many chunks of one project with one recount, for the
     * integration build. Returns the chunks that went stale.
     */
    readonly goStaleMany: (input: {
      readonly projectId: string
      readonly chunkIds: ReadonlyArray<string>
      readonly reason: string
    }) => Effect.Effect<ReadonlyArray<string>>
    /** `open` and `stale` chunks that use the type → `blocked`. */
    readonly blockForType: (projectId: string, typeName: string) => Effect.Effect<void>
    /** `blocked` chunks that use the type and no other unresolved type → `open` or `stale`. */
    readonly unblockForType: (projectId: string, typeName: string) => Effect.Effect<void>
    /** Members of a new fused parent: matches invalidated, `blocked`, pointing at the parent. */
    readonly fuse: (input: {
      readonly projectId: string
      readonly parentId: string
      readonly memberIds: ReadonlyArray<string>
    }) => Effect.Effect<void>
    /** Sweeper: end competing leases past their expiry. Board counts do not change. */
    readonly expireCompetingLeases: Effect.Effect<ReadonlyArray<{
      readonly chunk_id: string
      readonly user_id: string
      readonly project_id: string
      readonly name: string
    }>>
    /** Sweeper: end an expired primary lease (as `endPrimaryLease`). False when it is not expired any more. */
    readonly expireLease: (chunkId: string, projectId: string) => Effect.Effect<boolean>
  }
>()("rehydra/services/ChunkState") {
  static readonly layer = Layer.effect(
    ChunkState,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const stats = yield* ProjectChunkStats

      /**
       * A `leased` chunk back to the pool: `open`, or `stale` when a match was
       * invalidated and has not been replaced. The invalidated match stays the
       * starting attempt and stays out of the matched count.
       */
      const toPool = (chunkId: string) =>
        sql<{ readonly id: string }>`
          UPDATE chunks AS c
          SET
            state = CASE
              WHEN c.current_match_id IS NULL AND EXISTS (
                SELECT 1 FROM matches m
                WHERE m.chunk_id = c.id AND m.invalidated_at IS NOT NULL
              ) THEN 'stale'::chunk_state
              ELSE 'open'::chunk_state
            END,
            lease_user_id = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            hold_started_at = NULL,
            updated_at = now()
          WHERE c.id = ${chunkId}
            AND c.state = 'leased'
          RETURNING c.id
        `.pipe(Effect.map((rows) => rows[0] !== undefined))

      const endAllCompeting = (chunkId: string) =>
        sql`
          UPDATE chunk_leases
          SET released_at = now()
          WHERE chunk_id = ${chunkId}
            AND released_at IS NULL
        `

      const claim = Effect.fn("ChunkState.claim")(function*(input: {
        readonly chunkId: string
        readonly projectId: string
        readonly userId: string
        readonly leaseToken: string
        readonly leaseHours: number
      }) {
        const rows = yield* sql<ChunkRef>`
          UPDATE chunks AS c
          SET
            state = 'leased',
            lease_user_id = ${input.userId},
            lease_token = ${input.leaseToken},
            lease_expires_at = now() + make_interval(hours => ${input.leaseHours}),
            hold_started_at = COALESCE(c.hold_started_at, now()),
            updated_at = now()
          WHERE c.id = ${input.chunkId}
            AND c.project_id = ${input.projectId}
            AND c.state IN ('open', 'stale')
            AND c.lease_user_id IS NULL
            AND c.fuse_parent_id IS NULL
          RETURNING c.id, c.project_id, c.name
        `
        const claimed = rows[0]
        if (claimed !== undefined) yield* stats.refresh(claimed.project_id)
        return claimed
      }, Effect.orDie)

      const addCompetingLease = Effect.fn("ChunkState.addCompetingLease")(function*(input: {
        readonly chunkId: string
        readonly projectId: string
        readonly userId: string
        readonly leaseToken: string
      }) {
        // Lock the chunk in its own statement first. The insert below is a
        // new statement, so under READ COMMITTED its count sees every competing
        // lease committed before this lock was granted (audit A-009).
        yield* sql`
          SELECT id FROM chunks
          WHERE id = ${input.chunkId} AND project_id = ${input.projectId}
          FOR UPDATE
        `
        const rows = yield* sql<CompetingLease>`
          WITH inserted AS (
            INSERT INTO chunk_leases (
              chunk_id, user_id, lease_token, lease_expires_at, hold_started_at
            )
            SELECT
              c.id,
              ${input.userId},
              ${input.leaseToken},
              now() + make_interval(hours => p.lease_hours),
              now()
            FROM chunks c
            INNER JOIN projects p ON p.id = c.project_id
            WHERE c.id = ${input.chunkId}
              AND c.project_id = ${input.projectId}
              AND c.fuse_parent_id IS NULL
              AND c.state = 'leased'
              AND c.lease_user_id IS NOT NULL
              AND c.lease_user_id <> ${input.userId}
              AND p.max_concurrent_leases > 1
              AND (
                1 + (
                  SELECT COUNT(*)
                  FROM chunk_leases cl
                  WHERE cl.chunk_id = c.id
                    AND cl.released_at IS NULL
                )
              ) < p.max_concurrent_leases
              AND NOT EXISTS (
                SELECT 1 FROM chunk_leases cl
                WHERE cl.chunk_id = c.id
                  AND cl.user_id = ${input.userId}
                  AND cl.released_at IS NULL
              )
            RETURNING
              chunk_id, lease_token, lease_expires_at, hold_started_at
          )
          SELECT
            inserted.chunk_id,
            c.project_id,
            c.name,
            inserted.lease_token,
            inserted.lease_expires_at,
            inserted.hold_started_at
          FROM inserted
          INNER JOIN chunks c ON c.id = inserted.chunk_id
        `
        return rows[0]
      }, Effect.orDie)

      const extendLease = Effect.fn("ChunkState.extendLease")(function*(input: {
        readonly chunkId: string
        readonly projectSlug: string
        readonly userId: string
        readonly leaseToken: string
      }) {
        const rows = yield* sql<{ readonly id: string }>`
          UPDATE chunks AS c
          SET
            lease_expires_at = LEAST(
              now() + make_interval(hours => p.lease_hours),
              c.hold_started_at + make_interval(hours => p.max_hold_hours)
            ),
            updated_at = now()
          FROM projects p
          WHERE c.id = ${input.chunkId}
            AND c.project_id = p.id
            AND p.slug = ${input.projectSlug}
            AND c.state = 'leased'
            AND c.lease_user_id = ${input.userId}
            AND c.lease_token = ${input.leaseToken}
            AND c.hold_started_at IS NOT NULL
            -- Audit A-010: an expired lease is over, even before the sweep.
            AND c.lease_expires_at > now()
            AND now() < c.hold_started_at + make_interval(hours => p.max_hold_hours)
          RETURNING c.id
        `
        return rows[0] !== undefined
      }, Effect.orDie)

      const extendCompetingLease = Effect.fn("ChunkState.extendCompetingLease")(function*(input: {
        readonly chunkId: string
        readonly projectSlug: string
        readonly userId: string
        readonly leaseToken: string
      }) {
        const rows = yield* sql<CompetingLease>`
          UPDATE chunk_leases AS cl
          SET lease_expires_at = LEAST(
            now() + make_interval(hours => p.lease_hours),
            cl.hold_started_at + make_interval(hours => p.max_hold_hours)
          )
          FROM chunks c, projects p
          WHERE cl.chunk_id = c.id
            AND c.project_id = p.id
            AND c.id = ${input.chunkId}
            AND p.slug = ${input.projectSlug}
            AND cl.user_id = ${input.userId}
            AND cl.lease_token = ${input.leaseToken}
            AND cl.released_at IS NULL
            AND cl.lease_expires_at > now()
            AND c.state = 'leased'
            AND now() < cl.hold_started_at + make_interval(hours => p.max_hold_hours)
          RETURNING cl.chunk_id, c.project_id, c.name, cl.lease_token, cl.lease_expires_at, cl.hold_started_at
        `
        return rows[0]
      }, Effect.orDie)

      const promoteOrReturn = Effect.fnUntraced(function*(chunkId: string) {
        const next = yield* sql<{
          readonly id: string
          readonly user_id: string
          readonly lease_token: string
          readonly lease_expires_at: Date | string
          readonly hold_started_at: Date | string
        }>`
          SELECT id, user_id, lease_token, lease_expires_at, hold_started_at
          FROM chunk_leases
          WHERE chunk_id = ${chunkId}
            AND released_at IS NULL
            AND lease_expires_at > now()
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE
        `
        const holder = next[0]
        if (holder !== undefined) {
          const promoted = yield* sql<{ readonly id: string }>`
            UPDATE chunks
            SET
              state = 'leased',
              lease_user_id = ${holder.user_id},
              lease_token = ${holder.lease_token},
              lease_expires_at = ${holder.lease_expires_at},
              hold_started_at = ${holder.hold_started_at},
              updated_at = now()
            WHERE id = ${chunkId}
              AND state = 'leased'
            RETURNING id
          `
          if (promoted[0] !== undefined) {
            yield* sql`UPDATE chunk_leases SET released_at = now() WHERE id = ${holder.id}`
            return "promoted" as const
          }
        }
        yield* toPool(chunkId)
        return "returned" as const
      })

      const endPrimaryLease = Effect.fn("ChunkState.endPrimaryLease")(function*(chunkId: string, projectId: string) {
        const outcome = yield* promoteOrReturn(chunkId)
        if (outcome === "returned") yield* stats.refresh(projectId)
        return outcome
      }, Effect.orDie)

      const releaseCompetingLease = Effect.fn("ChunkState.releaseCompetingLease")(function*(input: {
        readonly chunkId: string
        readonly userId: string
        readonly leaseToken: string
      }) {
        const rows = yield* sql<{ readonly id: string }>`
          UPDATE chunk_leases cl
          SET released_at = now()
          FROM chunks c
          WHERE cl.chunk_id = c.id
            AND c.id = ${input.chunkId}
            AND cl.user_id = ${input.userId}
            AND cl.lease_token = ${input.leaseToken}
            AND cl.released_at IS NULL
            AND c.state IN ('leased', 'validating')
          RETURNING cl.id
        `
        return rows[0] !== undefined
      }, Effect.orDie)

      const returnToPool = Effect.fn("ChunkState.returnToPool")(function*(chunkId: string, projectId: string) {
        const returned = yield* toPool(chunkId)
        yield* endAllCompeting(chunkId)
        if (returned) yield* stats.refresh(projectId)
        return returned
      }, Effect.orDie)

      const endUserLeases = Effect.fn("ChunkState.endUserLeases")(function*(input: {
        readonly userId: string
        readonly projectId?: string
      }) {
        const projectId = input.projectId ?? null
        const held = yield* sql<{ readonly id: string; readonly project_id: string }>`
          SELECT id, project_id FROM chunks
          WHERE lease_user_id = ${input.userId}
            AND state = 'leased'
            AND (${projectId}::uuid IS NULL OR project_id = ${projectId}::uuid)
          FOR UPDATE
        `
        for (const chunk of held) {
          yield* toPool(chunk.id)
          yield* endAllCompeting(chunk.id)
        }
        const competing = yield* sql<{ readonly project_id: string }>`
          UPDATE chunk_leases cl
          SET released_at = now()
          FROM chunks c
          WHERE cl.chunk_id = c.id
            AND cl.user_id = ${input.userId}
            AND cl.released_at IS NULL
            AND (${projectId}::uuid IS NULL OR c.project_id = ${projectId}::uuid)
          RETURNING c.project_id
        `
        const touched = [...new Set(held.map((chunk) => chunk.project_id))]
        for (const id of touched) yield* stats.refresh(id)
        return [...new Set([...touched, ...competing.map((row) => row.project_id)])]
      }, Effect.orDie)

      const startValidating = Effect.fn("ChunkState.startValidating")(function*(input: {
        readonly chunkId: string
        readonly userId: string
        readonly leaseToken: string
        readonly primary: boolean
      }) {
        type Moved = { readonly chunk_id: string; readonly project_id: string }
        const rows = input.primary
          ? yield* sql<Moved>`
            UPDATE chunks c
            SET state = 'validating', updated_at = now()
            WHERE c.id = ${input.chunkId}
              AND c.state = 'leased'
              AND c.lease_user_id = ${input.userId}
              AND c.lease_token = ${input.leaseToken}
              AND c.lease_expires_at > now()
            RETURNING c.id AS chunk_id, c.project_id
          `
          : yield* sql<Moved>`
            WITH side AS (
              SELECT
                cl.chunk_id,
                cl.user_id,
                cl.lease_token,
                cl.lease_expires_at,
                cl.hold_started_at
              FROM chunk_leases cl
              WHERE cl.chunk_id = ${input.chunkId}
                AND cl.user_id = ${input.userId}
                AND cl.lease_token = ${input.leaseToken}
                AND cl.released_at IS NULL
                AND cl.lease_expires_at > now()
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
              WHERE c.state = 'leased'
                AND c.lease_user_id IS NOT NULL
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
            FROM side
            WHERE c.id = side.chunk_id
              AND c.state = 'leased'
              AND EXISTS (SELECT 1 FROM drop_side)
            RETURNING c.id AS chunk_id, c.project_id
          `
        const moved = rows[0]
        if (moved !== undefined) yield* stats.refresh(moved.project_id)
        return moved
      }, Effect.orDie)

      const recordMatch = Effect.fn("ChunkState.recordMatch")(function*(input: {
        readonly chunkId: string
        readonly projectId: string
        readonly leaseToken: string
        readonly matchId: string | null
        readonly attemptId: string
      }) {
        yield* endAllCompeting(input.chunkId)
        yield* sql`
          UPDATE chunks
          SET
            state = 'matched',
            current_match_id = ${input.matchId},
            best_attempt_id = ${input.attemptId},
            lease_user_id = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            hold_started_at = NULL,
            updated_at = now()
          WHERE id = ${input.chunkId}
            AND state = 'validating'
            AND lease_token = ${input.leaseToken}
        `
        yield* stats.refresh(input.projectId)
      }, Effect.orDie)

      const recordMiss = Effect.fn("ChunkState.recordMiss")(function*(input: {
        readonly chunkId: string
        readonly projectId: string
        readonly leaseToken: string
        readonly attemptId: string
      }) {
        yield* sql`
          UPDATE chunks AS c
          SET
            state = 'leased',
            best_attempt_id = ${input.attemptId},
            lease_expires_at = GREATEST(
              c.lease_expires_at,
              LEAST(
                now() + make_interval(hours => p.lease_hours),
                c.hold_started_at + make_interval(hours => p.max_hold_hours)
              )
            ),
            updated_at = now()
          FROM projects p
          WHERE c.id = ${input.chunkId}
            AND c.project_id = p.id
            AND c.state = 'validating'
            AND c.lease_token = ${input.leaseToken}
        `
        yield* stats.refresh(input.projectId)
      }, Effect.orDie)

      const returnFromValidating = Effect.fn("ChunkState.returnFromValidating")(function*(input: {
        readonly chunkId: string
        readonly projectId: string
        readonly jobId: string
        readonly leaseToken: string | null
      }) {
        // The lease keeps its expiry, or gets a fresh one if none was stored.
        const rows = yield* sql<{ readonly id: string }>`
          UPDATE chunks AS c
          SET
            state = 'leased',
            lease_expires_at = COALESCE(
              c.lease_expires_at,
              now() + make_interval(hours => p.lease_hours)
            ),
            updated_at = now()
          FROM projects p
          WHERE c.id = ${input.chunkId}
            AND c.project_id = p.id
            AND c.state = 'validating'
            AND (${input.leaseToken}::uuid IS NULL OR c.lease_token = ${input.leaseToken}::uuid)
            AND NOT EXISTS (
              SELECT 1 FROM jobs j
              WHERE j.chunk_id = c.id
                AND j.kind = 'interactive'
                AND j.state IN ('queued', 'claimed')
                AND j.id <> ${input.jobId}
            )
          RETURNING c.id
        `
        if (rows[0] === undefined) return false
        yield* stats.refresh(input.projectId)
        return true
      }, Effect.orDie)

      const returnOrphanedValidating = Effect.gen(function*() {
        const rows = yield* sql<ChunkRef>`
          UPDATE chunks AS c
          SET
            state = 'leased',
            lease_expires_at = COALESCE(
              c.lease_expires_at,
              now() + make_interval(hours => p.lease_hours)
            ),
            updated_at = now()
          FROM projects p
          WHERE c.project_id = p.id
            AND c.state = 'validating'
            AND c.updated_at < now() - interval '5 minutes'
            AND NOT EXISTS (
              SELECT 1 FROM jobs j
              WHERE j.chunk_id = c.id
                AND j.kind = 'interactive'
                AND j.state IN ('queued', 'claimed')
            )
          RETURNING c.id, c.project_id, c.name
        `
        for (const id of new Set(rows.map((row) => row.project_id))) yield* stats.refresh(id)
        return rows
      }).pipe(Effect.orDie, Effect.withSpan("ChunkState.returnOrphanedValidating"))

      const goStale = Effect.fn("ChunkState.goStale")(function*(input: {
        readonly chunkId: string
        readonly projectId: string
        readonly reason: string
        readonly matchId?: string
        readonly onlyInlineAsm?: boolean
      }) {
        if (input.onlyInlineAsm === true) {
          const invalidated = yield* sql<{ readonly id: string }>`
            UPDATE matches m
            SET invalidated_at = now(), invalidated_reason = ${input.reason}
            FROM chunks c
            WHERE c.id = ${input.chunkId}
              AND m.id = c.current_match_id
              AND m.uses_inline_asm
              AND m.invalidated_at IS NULL
            RETURNING m.id
          `
          if (invalidated[0] === undefined) return false
        } else if (input.matchId !== undefined) {
          yield* sql`
            UPDATE matches
            SET invalidated_at = now(), invalidated_reason = ${input.reason}
            WHERE id = ${input.matchId}
              AND invalidated_at IS NULL
          `
        } else {
          yield* sql`
            UPDATE matches
            SET invalidated_at = now(), invalidated_reason = ${input.reason}
            WHERE chunk_id = ${input.chunkId}
              AND invalidated_at IS NULL
          `
        }
        const stale = yield* sql<{ readonly id: string }>`
          UPDATE chunks
          SET
            state = 'stale',
            current_match_id = NULL,
            lease_user_id = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            hold_started_at = NULL,
            updated_at = now()
          WHERE id = ${input.chunkId}
            AND state = 'matched'
          RETURNING id
        `
        if (stale[0] === undefined) return false
        yield* stats.refresh(input.projectId)
        return true
      }, Effect.orDie)

      const goStaleMany = Effect.fn("ChunkState.goStaleMany")(function*(input: {
        readonly projectId: string
        readonly chunkIds: ReadonlyArray<string>
        readonly reason: string
      }) {
        const ids = [...new Set(input.chunkIds)]
        if (ids.length === 0) return []
        yield* sql`
          UPDATE matches
          SET invalidated_at = now(), invalidated_reason = ${input.reason}
          WHERE chunk_id = ANY(${ids}::uuid[])
            AND invalidated_at IS NULL
        `
        const stale = yield* sql<{ readonly id: string }>`
          UPDATE chunks
          SET
            state = 'stale',
            current_match_id = NULL,
            lease_user_id = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            hold_started_at = NULL,
            updated_at = now()
          WHERE id = ANY(${ids}::uuid[])
            AND project_id = ${input.projectId}
            AND state = 'matched'
          RETURNING id
        `
        if (stale.length > 0) yield* stats.refresh(input.projectId)
        return stale.map((row) => row.id)
      }, Effect.orDie)

      const blockForType = Effect.fn("ChunkState.blockForType")(function*(projectId: string, typeName: string) {
        yield* sql`
          UPDATE chunks c
          SET
            state = 'blocked',
            lease_user_id = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            hold_started_at = NULL,
            updated_at = now()
          FROM chunk_type_refs ctr
          WHERE ctr.chunk_id = c.id
            AND ctr.type_name = ${typeName}
            AND c.project_id = ${projectId}
            AND c.fuse_parent_id IS NULL
            AND c.state IN ('open', 'stale')
        `
        yield* stats.refresh(projectId)
      }, Effect.orDie)

      const unblockForType = Effect.fn("ChunkState.unblockForType")(function*(projectId: string, typeName: string) {
        yield* sql`
          UPDATE chunks c
          SET
            state = CASE
              WHEN c.current_match_id IS NULL AND EXISTS (
                SELECT 1 FROM matches m
                WHERE m.chunk_id = c.id AND m.invalidated_at IS NOT NULL
              ) THEN 'stale'::chunk_state
              ELSE 'open'::chunk_state
            END,
            updated_at = now()
          WHERE c.project_id = ${projectId}
            AND c.state = 'blocked'
            AND c.fuse_parent_id IS NULL
            AND EXISTS (
              SELECT 1 FROM chunk_type_refs ctr
              WHERE ctr.chunk_id = c.id AND ctr.type_name = ${typeName}
            )
            AND NOT EXISTS (
              SELECT 1
              FROM chunk_type_refs ctr2
              INNER JOIN unresolved_types ut
                ON ut.project_id = c.project_id
               AND ut.type_name = ctr2.type_name
               AND ut.cleared_at IS NULL
              WHERE ctr2.chunk_id = c.id
            )
        `
        yield* stats.refresh(projectId)
      }, Effect.orDie)

      const fuse = Effect.fn("ChunkState.fuse")(function*(input: {
        readonly projectId: string
        readonly parentId: string
        readonly memberIds: ReadonlyArray<string>
      }) {
        for (const memberId of input.memberIds) {
          yield* sql`
            UPDATE matches
            SET invalidated_at = now(), invalidated_reason = 'fused into parent chunk'
            WHERE chunk_id = ${memberId}
              AND invalidated_at IS NULL
          `
          yield* sql`
            UPDATE chunks
            SET
              fuse_parent_id = ${input.parentId},
              state = 'blocked',
              current_match_id = NULL,
              lease_user_id = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              hold_started_at = NULL,
              updated_at = now()
            WHERE id = ${memberId}
          `
        }
        yield* stats.refresh(input.projectId)
      }, Effect.orDie)

      const expireCompetingLeases = sql<{
          readonly chunk_id: string
          readonly user_id: string
          readonly project_id: string
          readonly name: string
        }>`
          UPDATE chunk_leases cl
          SET released_at = now()
          FROM chunks c
          WHERE cl.chunk_id = c.id
            AND cl.released_at IS NULL
            AND cl.lease_expires_at < now()
          RETURNING cl.chunk_id, cl.user_id, c.project_id, c.name
        `.pipe(Effect.orDie, Effect.withSpan("ChunkState.expireCompetingLeases"))

      const expireLease = Effect.fn("ChunkState.expireLease")(function*(chunkId: string, projectId: string) {
        const locked = yield* sql<{ readonly id: string }>`
          SELECT id
          FROM chunks
          WHERE id = ${chunkId}
            AND state = 'leased'
            AND lease_expires_at < now()
          FOR UPDATE
        `
        if (locked[0] === undefined) return false
        const outcome = yield* promoteOrReturn(chunkId)
        if (outcome === "returned") yield* stats.refresh(projectId)
        return true
      }, Effect.orDie)

      return ChunkState.of({
        claim,
        addCompetingLease,
        extendLease,
        extendCompetingLease,
        endPrimaryLease,
        releaseCompetingLease,
        returnToPool,
        endUserLeases,
        startValidating,
        recordMatch,
        recordMiss,
        returnFromValidating,
        returnOrphanedValidating,
        goStale,
        goStaleMany,
        blockForType,
        unblockForType,
        fuse,
        expireCompetingLeases,
        expireLease
      })
    })
  )
}
