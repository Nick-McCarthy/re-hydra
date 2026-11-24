import { Context, Effect, Layer } from "effect"
import { NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import type {
  MatchedChunkRef,
  MyWork,
  PublicUserProfile,
  UserMatchesPage,
  UserProjectRef,
  WorkAttempt
} from "../domain/Profile.js"
import { Uuid } from "../domain/Uuid.js"

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

export class UsersRepo extends Context.Service<
  UsersRepo,
  {
    readonly getPublicProfile: (
      userId: Uuid
    ) => Effect.Effect<PublicUserProfile, NotFound>
    /** Profile phase 1: the signed-in user's leases and recent submissions. */
    readonly myWork: (userId: Uuid) => Effect.Effect<MyWork>
    readonly matches: (
      userId: Uuid,
      options: {
        readonly project?: string | undefined
        readonly status?: "active" | "invalidated" | undefined
        readonly sort?: "newest" | "oldest" | undefined
        readonly limit?: number | undefined
        readonly offset?: number | undefined
      }
    ) => Effect.Effect<UserMatchesPage, NotFound>
    readonly projects: (userId: Uuid) => Effect.Effect<ReadonlyArray<UserProjectRef>, NotFound>
  }
>()("rehydra/services/UsersRepo") {
  static readonly layer = Layer.effect(
    UsersRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient

      const getPublicProfile = Effect.fn("UsersRepo.getPublicProfile")(
        function*(userId: Uuid) {
          const users = yield* sql<{
            readonly id: string
            readonly display_name: string
            readonly created_at: Date | string
            readonly surviving: number
            readonly assembly: number
            readonly regressions: number
            readonly follower_count: number
            readonly following_count: number
          }>`
            SELECT
              u.id,
              u.display_name,
              u.created_at,
              -- Audit A-041: assembly matches do not count toward reputation.
              (
                SELECT COUNT(*)::int
                FROM matches m
                INNER JOIN chunks c ON c.current_match_id = m.id
                WHERE m.user_id = u.id
                  AND m.invalidated_at IS NULL
                  AND NOT m.uses_inline_asm
              ) AS surviving,
              (
                SELECT COUNT(*)::int
                FROM matches m
                INNER JOIN chunks c ON c.current_match_id = m.id
                WHERE m.user_id = u.id
                  AND m.invalidated_at IS NULL
                  AND m.uses_inline_asm
              ) AS assembly,
              (
                SELECT COUNT(*)::int
                FROM proposal_regressions r
                WHERE r.caused_by = u.id
              ) AS regressions,
              (
                SELECT COUNT(*)::int
                FROM follows f
                WHERE f.followee_id = u.id
              ) AS follower_count,
              (
                SELECT COUNT(*)::int
                FROM follows f
                WHERE f.follower_id = u.id
              ) AS following_count
            FROM users u
            WHERE u.id = ${userId}
            LIMIT 1
          `.pipe(Effect.orDie)

          const user = users[0]
          if (user === undefined) {
            return yield* new NotFound()
          }

          const matches = yield* sql<{
            readonly match_id: string
            readonly chunk_id: string
            readonly project_slug: string
            readonly project_name: string
            readonly chunk_name: string
            readonly address: string | number | bigint
            readonly language: string
            readonly created_at: Date | string
            readonly invalidated_at: Date | string | null
            readonly uses_inline_asm: boolean
          }>`
            SELECT
              m.id AS match_id,
              m.chunk_id,
              p.slug AS project_slug,
              p.name AS project_name,
              c.name AS chunk_name,
              c.address,
              m.language,
              m.created_at,
              m.invalidated_at,
              m.uses_inline_asm
            FROM matches m
            INNER JOIN chunks c ON c.id = m.chunk_id
            INNER JOIN projects p ON p.id = c.project_id
            WHERE m.user_id = ${userId}
              AND p.archived_at IS NULL
            ORDER BY m.created_at DESC
            LIMIT 100
          `.pipe(Effect.orDie)

          const projects = yield* sql<{
            readonly slug: string
            readonly name: string
            readonly role: "owner" | "maintainer"
          }>`
            SELECT p.slug, p.name, pm.role
            FROM project_members pm
            INNER JOIN projects p ON p.id = pm.project_id
            WHERE pm.user_id = ${userId}
              AND pm.role IN ('owner', 'maintainer')
              AND p.archived_at IS NULL
            ORDER BY p.name
          `.pipe(Effect.orDie)

          const matchedChunks = matches.map((row) => ({
            matchId: row.match_id,
            chunkId: row.chunk_id,
            projectSlug: row.project_slug,
            projectName: row.project_name,
            chunkName: row.chunk_name,
            address: String(row.address),
            language: row.language,
            createdAt: toIso(row.created_at),
            active: row.invalidated_at === null,
            usesInlineAsm: row.uses_inline_asm
          }))

          return {
            id: user.id,
            displayName: user.display_name,
            createdAt: toIso(user.created_at),
            matchedCount: user.surviving,
            survivingMatches: user.surviving,
            assemblyMatches: user.assembly,
            regressions: user.regressions,
            reputation: user.surviving - user.regressions,
            followerCount: user.follower_count,
            followingCount: user.following_count,
            matchedChunks,
            projects
          } satisfies PublicUserProfile
        }
      )

      const requireUser = (userId: Uuid) =>
        sql<{ readonly id: string }>`SELECT id FROM users WHERE id = ${userId} LIMIT 1`.pipe(
          Effect.orDie,
          Effect.flatMap((rows) => rows[0] === undefined ? Effect.fail(new NotFound()) : Effect.void)
        )

      type AttemptRow = {
        readonly id: string
        readonly project_slug: string
        readonly project_name: string
        readonly chunk_id: string
        readonly chunk_name: string
        readonly created_at: Date | string
        readonly finished_at: Date | string | null
        readonly matched: boolean | null
        readonly compiler_ok: boolean | null
        readonly score: string | number | null
      }
      const toAttempt = (row: AttemptRow): WorkAttempt => ({
        attemptId: row.id as Uuid,
        projectSlug: row.project_slug,
        projectName: row.project_name,
        chunkId: row.chunk_id as Uuid,
        chunkName: row.chunk_name,
        createdAt: toIso(row.created_at),
        finishedAt: row.finished_at === null ? null : toIso(row.finished_at),
        result: row.finished_at === null
          ? "checking"
          : row.matched === true
          ? "matched"
          : row.compiler_ok === false
          ? "compile_error"
          : "missed",
        score: row.score === null ? null : Number(row.score)
      })

      const myWork = Effect.fn("UsersRepo.myWork")(function*(userId: Uuid) {
        const leases = yield* sql<{
          readonly project_slug: string
          readonly project_name: string
          readonly chunk_id: string
          readonly chunk_name: string
          readonly address: string | number | bigint
          readonly kind: "primary" | "competing"
          readonly lease_token: string
          readonly lease_expires_at: Date | string
          readonly hold_started_at: Date | string
        }>`
          SELECT p.slug AS project_slug, p.name AS project_name, c.id AS chunk_id, c.name AS chunk_name,
                 c.address, 'primary' AS kind, c.lease_token, c.lease_expires_at, c.hold_started_at
          FROM chunks c
          INNER JOIN projects p ON p.id = c.project_id AND p.archived_at IS NULL
          WHERE c.lease_user_id = ${userId}
            AND c.state = 'leased'
            AND c.lease_expires_at > now()
          UNION ALL
          SELECT p.slug, p.name, c.id, c.name, c.address, 'competing', cl.lease_token,
                 cl.lease_expires_at, cl.hold_started_at
          FROM chunk_leases cl
          INNER JOIN chunks c ON c.id = cl.chunk_id
          INNER JOIN projects p ON p.id = c.project_id AND p.archived_at IS NULL
          WHERE cl.user_id = ${userId}
            AND cl.released_at IS NULL
            AND cl.lease_expires_at > now()
          ORDER BY lease_expires_at
        `.pipe(Effect.orDie)

        const attempts = (finished: boolean, limit: number) =>
          sql<AttemptRow>`
            SELECT a.id, p.slug AS project_slug, p.name AS project_name, c.id AS chunk_id,
                   c.name AS chunk_name, a.created_at, a.finished_at, a.matched, a.compiler_ok, a.score
            FROM attempts a
            INNER JOIN chunks c ON c.id = a.chunk_id
            INNER JOIN projects p ON p.id = c.project_id AND p.archived_at IS NULL
            WHERE a.user_id = ${userId}
              AND (a.finished_at IS NOT NULL) = ${finished}
            ORDER BY a.created_at DESC
            LIMIT ${limit}
          `.pipe(Effect.orDie, Effect.map((rows) => rows.map(toAttempt)))

        return {
          leases: leases.map((row) => ({
            projectSlug: row.project_slug,
            projectName: row.project_name,
            chunkId: row.chunk_id as Uuid,
            chunkName: row.chunk_name,
            address: String(row.address),
            kind: row.kind,
            leaseToken: row.lease_token as Uuid,
            leaseExpiresAt: toIso(row.lease_expires_at),
            holdStartedAt: toIso(row.hold_started_at)
          })),
          checking: yield* attempts(false, 50),
          recent: yield* attempts(true, 10)
        } satisfies MyWork
      })

      const matches = Effect.fn("UsersRepo.matches")(function*(
        userId: Uuid,
        options: {
          readonly project?: string | undefined
          readonly status?: "active" | "invalidated" | undefined
          readonly sort?: "newest" | "oldest" | undefined
          readonly limit?: number | undefined
          readonly offset?: number | undefined
        }
      ) {
        yield* requireUser(userId)
        const project = options.project ?? null
        const status = options.status ?? null
        const oldest = options.sort === "oldest"
        const limit = options.limit ?? 25
        const offset = options.offset ?? 0
        const rows = yield* sql<{
          readonly match_id: string
          readonly chunk_id: string
          readonly project_slug: string
          readonly project_name: string
          readonly chunk_name: string
          readonly address: string | number | bigint
          readonly language: string
          readonly created_at: Date | string
          readonly invalidated_at: Date | string | null
          readonly uses_inline_asm: boolean
          readonly total: number
        }>`
          SELECT
            m.id AS match_id, m.chunk_id, p.slug AS project_slug, p.name AS project_name,
            c.name AS chunk_name, c.address, m.language, m.created_at, m.invalidated_at,
            m.uses_inline_asm, COUNT(*) OVER ()::int AS total
          FROM matches m
          INNER JOIN chunks c ON c.id = m.chunk_id
          INNER JOIN projects p ON p.id = c.project_id
          WHERE m.user_id = ${userId}
            AND p.archived_at IS NULL
            AND (${project}::text IS NULL OR p.slug = ${project})
            AND (
              ${status}::text IS NULL
              OR (${status} = 'active' AND m.invalidated_at IS NULL)
              OR (${status} = 'invalidated' AND m.invalidated_at IS NOT NULL)
            )
          ORDER BY
            CASE WHEN ${oldest} THEN m.created_at END ASC,
            m.created_at DESC,
            m.id
          LIMIT ${limit} OFFSET ${offset}
        `.pipe(Effect.orDie)
        let total = rows[0]?.total
        if (total === undefined) {
          // Past the last page, or nothing matches: count without the window.
          const counted = yield* sql<{ readonly n: number }>`
            SELECT COUNT(*)::int AS n
            FROM matches m
            INNER JOIN chunks c ON c.id = m.chunk_id
            INNER JOIN projects p ON p.id = c.project_id
            WHERE m.user_id = ${userId}
              AND p.archived_at IS NULL
              AND (${project}::text IS NULL OR p.slug = ${project})
              AND (
                ${status}::text IS NULL
                OR (${status} = 'active' AND m.invalidated_at IS NULL)
                OR (${status} = 'invalidated' AND m.invalidated_at IS NOT NULL)
              )
          `.pipe(Effect.orDie)
          total = counted[0]?.n ?? 0
        }
        return {
          items: rows.map((row): MatchedChunkRef => ({
            matchId: row.match_id as Uuid,
            chunkId: row.chunk_id as Uuid,
            projectSlug: row.project_slug,
            projectName: row.project_name,
            chunkName: row.chunk_name,
            address: String(row.address),
            language: row.language,
            createdAt: toIso(row.created_at),
            active: row.invalidated_at === null,
            usesInlineAsm: row.uses_inline_asm
          })),
          total
        } satisfies UserMatchesPage
      })

      const projects = Effect.fn("UsersRepo.projects")(function*(userId: Uuid) {
        yield* requireUser(userId)
        const rows = yield* sql<{
          readonly slug: string
          readonly name: string
          readonly role: "owner" | "maintainer" | "contributor" | null
          readonly match_count: number
        }>`
          WITH mine AS (
            SELECT c.project_id, COUNT(*)::int AS n
            FROM matches m
            INNER JOIN chunks c ON c.current_match_id = m.id
            WHERE m.user_id = ${userId} AND m.invalidated_at IS NULL
            GROUP BY c.project_id
          )
          SELECT p.slug, p.name, pm.role, COALESCE(mine.n, 0) AS match_count
          FROM projects p
          LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ${userId}
          LEFT JOIN mine ON mine.project_id = p.id
          WHERE p.archived_at IS NULL
            AND (pm.user_id IS NOT NULL OR mine.n IS NOT NULL)
          ORDER BY
            CASE pm.role WHEN 'owner' THEN 0 WHEN 'maintainer' THEN 1 WHEN 'contributor' THEN 2 ELSE 3 END,
            COALESCE(mine.n, 0) DESC,
            p.name
        `.pipe(Effect.orDie)
        return rows.map((row): UserProjectRef => ({
          slug: row.slug,
          name: row.name,
          role: row.role,
          matchCount: row.match_count
        }))
      })

      return UsersRepo.of({ getPublicProfile, myWork, matches, projects })
    })
  )
}
