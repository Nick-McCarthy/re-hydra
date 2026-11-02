import { Context, Effect, Layer } from "effect"
import { Conflict, NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import type { FollowState, ProjectEvent, UserSearchHit } from "../domain/Directory.js"
import { likeContains } from "../domain/Directory.js"
import { Uuid } from "../domain/Uuid.js"

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

type EventRow = {
  readonly id: string
  readonly project_id: string
  readonly project_slug: string
  readonly project_name: string
  readonly actor_id: string | null
  readonly actor_name: string | null
  readonly kind: ProjectEvent["kind"]
  readonly chunk_id: string | null
  readonly chunk_name: string | null
  readonly summary: string
  readonly created_at: Date | string
}

const toEvent = (row: EventRow): ProjectEvent => ({
  id: row.id,
  projectId: row.project_id,
  projectSlug: row.project_slug,
  projectName: row.project_name,
  ...(row.actor_id !== null ? { actorId: row.actor_id } : {}),
  ...(row.actor_name !== null ? { actorName: row.actor_name } : {}),
  kind: row.kind,
  ...(row.chunk_id !== null ? { chunkId: row.chunk_id } : {}),
  ...(row.chunk_name !== null ? { chunkName: row.chunk_name } : {}),
  summary: row.summary,
  createdAt: toIso(row.created_at)
})

export class DirectoryRepo extends Context.Service<
  DirectoryRepo,
  {
    readonly activity: (
      projectSlug: string
    ) => Effect.Effect<ReadonlyArray<ProjectEvent>, NotFound>
    readonly feed: (userId: Uuid) => Effect.Effect<ReadonlyArray<ProjectEvent>>
    readonly searchUsers: (q: string | undefined) => Effect.Effect<ReadonlyArray<UserSearchHit>>
    readonly followProject: (
      projectSlug: string,
      userId: Uuid
    ) => Effect.Effect<FollowState, NotFound>
    readonly unfollowProject: (
      projectSlug: string,
      userId: Uuid
    ) => Effect.Effect<FollowState, NotFound>
    readonly projectFollowState: (
      projectSlug: string,
      userId: Uuid
    ) => Effect.Effect<FollowState, NotFound>
    readonly followUser: (
      followeeId: Uuid,
      userId: Uuid
    ) => Effect.Effect<FollowState, NotFound | Conflict>
    readonly unfollowUser: (
      followeeId: Uuid,
      userId: Uuid
    ) => Effect.Effect<FollowState, NotFound | Conflict>
    readonly userFollowState: (
      followeeId: Uuid,
      userId: Uuid
    ) => Effect.Effect<FollowState, NotFound>
  }
>()("rehydra/services/DirectoryRepo") {
  static readonly layer = Layer.effect(
    DirectoryRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient

      const activity = Effect.fn("DirectoryRepo.activity")(function*(projectSlug: string) {
        const projects = yield* sql<{ readonly id: string }>`
          SELECT id FROM projects
          WHERE slug = ${projectSlug} AND archived_at IS NULL
          LIMIT 1
        `.pipe(Effect.orDie)
        if (projects[0] === undefined) {
          return yield* new NotFound()
        }

        const rows = yield* sql<EventRow>`
          SELECT
            e.id,
            e.project_id,
            p.slug AS project_slug,
            p.name AS project_name,
            e.actor_id,
            u.display_name AS actor_name,
            e.kind,
            e.chunk_id,
            c.name AS chunk_name,
            e.summary,
            e.created_at
          FROM project_events e
          INNER JOIN projects p ON p.id = e.project_id
          LEFT JOIN users u ON u.id = e.actor_id
          LEFT JOIN chunks c ON c.id = e.chunk_id
          WHERE p.slug = ${projectSlug}
            AND p.archived_at IS NULL
          ORDER BY e.created_at DESC
          LIMIT 50
        `.pipe(Effect.orDie)

        return rows.map(toEvent)
      })

      const feed = Effect.fn("DirectoryRepo.feed")(function*(userId: Uuid) {
        const rows = yield* sql<EventRow>`
          SELECT
            e.id,
            e.project_id,
            p.slug AS project_slug,
            p.name AS project_name,
            e.actor_id,
            u.display_name AS actor_name,
            e.kind,
            e.chunk_id,
            c.name AS chunk_name,
            e.summary,
            e.created_at
          FROM project_events e
          INNER JOIN projects p ON p.id = e.project_id
          LEFT JOIN users u ON u.id = e.actor_id
          LEFT JOIN chunks c ON c.id = e.chunk_id
          WHERE p.archived_at IS NULL
            AND (
              EXISTS (
                SELECT 1 FROM follows f
                WHERE f.follower_id = ${userId}
                  AND f.project_id = e.project_id
              )
              OR EXISTS (
                SELECT 1 FROM follows f
                WHERE f.follower_id = ${userId}
                  AND f.followee_id = e.actor_id
              )
            )
          ORDER BY e.created_at DESC
          LIMIT 50
        `.pipe(Effect.orDie)
        return rows.map(toEvent)
      })

      const searchUsers = Effect.fn("DirectoryRepo.searchUsers")(function*(
        q: string | undefined
      ) {
        const pattern = likeContains(q)
        if (pattern === null) {
          return []
        }

        const rows = yield* sql<{
          readonly id: string
          readonly display_name: string
          readonly created_at: Date | string
          readonly surviving: number
          readonly regressions: number
        }>`
          SELECT
            u.id,
            u.display_name,
            u.created_at,
            (
              SELECT COUNT(*)::int
              FROM matches m
              INNER JOIN chunks c ON c.current_match_id = m.id
              WHERE m.user_id = u.id
                AND m.invalidated_at IS NULL
            ) AS surviving,
            (
              SELECT COUNT(*)::int
              FROM proposal_regressions r
              WHERE r.caused_by = u.id
            ) AS regressions
          FROM users u
          WHERE u.display_name ILIKE ${pattern} ESCAPE '\\'
          ORDER BY u.display_name
          LIMIT 20
        `.pipe(Effect.orDie)

        return rows.map((row): UserSearchHit => ({
          id: row.id,
          displayName: row.display_name,
          survivingMatches: row.surviving,
          regressions: row.regressions,
          reputation: row.surviving - row.regressions,
          createdAt: toIso(row.created_at)
        }))
      })

      const followProject = Effect.fn("DirectoryRepo.followProject")(function*(
        projectSlug: string,
        userId: Uuid
      ) {
        const rows = yield* sql<{ readonly project_id: string | null }>`
          WITH target AS (
            SELECT id FROM projects
            WHERE slug = ${projectSlug} AND archived_at IS NULL
          ),
          inserted AS (
            INSERT INTO follows (follower_id, project_id)
            SELECT ${userId}, id FROM target
            ON CONFLICT (follower_id, project_id) WHERE project_id IS NOT NULL
            DO NOTHING
            RETURNING project_id
          )
          SELECT (SELECT id FROM target) AS project_id
        `.pipe(Effect.orDie)

        if (rows[0]?.project_id == null) {
          return yield* new NotFound()
        }
        return { following: true } satisfies FollowState
      })

      const unfollowProject = Effect.fn("DirectoryRepo.unfollowProject")(function*(
        projectSlug: string,
        userId: Uuid
      ) {
        const projects = yield* sql<{ readonly id: string }>`
          SELECT id FROM projects
          WHERE slug = ${projectSlug} AND archived_at IS NULL
          LIMIT 1
        `.pipe(Effect.orDie)
        const project = projects[0]
        if (project === undefined) {
          return yield* new NotFound()
        }
        yield* sql`
          DELETE FROM follows
          WHERE follower_id = ${userId}
            AND project_id = ${project.id}
        `.pipe(Effect.orDie)
        return { following: false } satisfies FollowState
      })

      const projectFollowState = Effect.fn("DirectoryRepo.projectFollowState")(function*(
        projectSlug: string,
        userId: Uuid
      ) {
        const rows = yield* sql<{ readonly id: string; readonly following: boolean }>`
          SELECT
            p.id,
            EXISTS (
              SELECT 1 FROM follows f
              WHERE f.follower_id = ${userId}
                AND f.project_id = p.id
            ) AS following
          FROM projects p
          WHERE p.slug = ${projectSlug}
            AND p.archived_at IS NULL
          LIMIT 1
        `.pipe(Effect.orDie)
        const row = rows[0]
        if (row === undefined) {
          return yield* new NotFound()
        }
        return { following: row.following } satisfies FollowState
      })

      const followUser = Effect.fn("DirectoryRepo.followUser")(function*(
        followeeId: Uuid,
        userId: Uuid
      ) {
        if (followeeId === userId) {
          return yield* new Conflict()
        }
        const rows = yield* sql<{ readonly followee_id: string | null }>`
          WITH target AS (
            SELECT id FROM users WHERE id = ${followeeId}
          ),
          inserted AS (
            INSERT INTO follows (follower_id, followee_id)
            SELECT ${userId}, id FROM target
            ON CONFLICT (follower_id, followee_id) WHERE followee_id IS NOT NULL
            DO NOTHING
            RETURNING followee_id
          )
          SELECT (SELECT id FROM target) AS followee_id
        `.pipe(Effect.orDie)
        if (rows[0]?.followee_id == null) {
          return yield* new NotFound()
        }
        return { following: true } satisfies FollowState
      })

      const unfollowUser = Effect.fn("DirectoryRepo.unfollowUser")(function*(
        followeeId: Uuid,
        userId: Uuid
      ) {
        if (followeeId === userId) {
          return yield* new Conflict()
        }
        const users = yield* sql<{ readonly id: string }>`
          SELECT id FROM users WHERE id = ${followeeId} LIMIT 1
        `.pipe(Effect.orDie)
        if (users[0] === undefined) {
          return yield* new NotFound()
        }
        yield* sql`
          DELETE FROM follows
          WHERE follower_id = ${userId}
            AND followee_id = ${followeeId}
        `.pipe(Effect.orDie)
        return { following: false } satisfies FollowState
      })

      const userFollowState = Effect.fn("DirectoryRepo.userFollowState")(function*(
        followeeId: Uuid,
        userId: Uuid
      ) {
        const rows = yield* sql<{ readonly id: string; readonly following: boolean }>`
          SELECT
            u.id,
            EXISTS (
              SELECT 1 FROM follows f
              WHERE f.follower_id = ${userId}
                AND f.followee_id = u.id
            ) AS following
          FROM users u
          WHERE u.id = ${followeeId}
          LIMIT 1
        `.pipe(Effect.orDie)
        const row = rows[0]
        if (row === undefined) {
          return yield* new NotFound()
        }
        return { following: row.following } satisfies FollowState
      })

      return DirectoryRepo.of({
        activity,
        feed,
        searchUsers,
        followProject,
        unfollowProject,
        projectFollowState,
        followUser,
        unfollowUser,
        userFollowState
      })
    })
  )
}
