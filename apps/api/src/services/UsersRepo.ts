import { Context, Effect, Layer } from "effect"
import { NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import type { PublicUserProfile } from "../domain/Profile.js"
import { Uuid } from "../domain/Uuid.js"

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

export class UsersRepo extends Context.Service<
  UsersRepo,
  {
    readonly getPublicProfile: (
      userId: Uuid
    ) => Effect.Effect<PublicUserProfile, NotFound>
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

      return UsersRepo.of({ getPublicProfile })
    })
  )
}
