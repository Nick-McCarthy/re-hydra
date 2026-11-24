import { Context, Effect, Layer } from "effect"
import { Forbidden, NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import {
  type JoinRequest,
  type JoinRequestPayload,
  JoinRequestRefused,
  type MyJoinRequests,
  type MyJoinRequestState,
  ProjectAccessDenied
} from "../domain/Project.js"
import type { Uuid } from "../domain/Uuid.js"
import { Activity } from "./Activity.js"
import { ProjectAuth } from "./ProjectAuth.js"

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

/** After a decline, the user may ask the same project again this long after. */
const RETRY_DAYS = 7

type Requests = ReadonlyArray<JoinRequest>

/**
 * Join requests for members-only projects.
 *
 * - A signed-in non-member who is not blocked asks, with an optional short
 *   message. One open request per user per project; after a decline, they
 *   wait 7 days.
 * - Owners and maintainers approve (the user becomes a contributor) or
 *   decline, on the project page or across projects from their profile.
 * - Requests and declines are private. Only an approval reaches the public
 *   activity feed, as "X joined as contributor".
 * - Blocking a user cancels their open request (ProjectModeration); adding
 *   them directly marks it approved (ProjectMembers).
 */
export class ProjectJoinRequests extends Context.Service<
  ProjectJoinRequests,
  {
    readonly mine: (projectSlug: string, userId: Uuid) => Effect.Effect<MyJoinRequestState, NotFound>
    readonly create: (
      projectSlug: string,
      userId: Uuid,
      payload: JoinRequestPayload
    ) => Effect.Effect<MyJoinRequestState, NotFound | JoinRequestRefused | ProjectAccessDenied>
    readonly cancel: (projectSlug: string, userId: Uuid) => Effect.Effect<MyJoinRequestState, NotFound>
    readonly listForProject: (projectSlug: string, actorId: Uuid) => Effect.Effect<Requests, NotFound | Forbidden>
    readonly forMe: (actorId: Uuid) => Effect.Effect<MyJoinRequests>
    readonly approve: (
      projectSlug: string,
      actorId: Uuid,
      requestId: Uuid
    ) => Effect.Effect<Requests, NotFound | Forbidden | ProjectAccessDenied>
    readonly decline: (
      projectSlug: string,
      actorId: Uuid,
      requestId: Uuid
    ) => Effect.Effect<Requests, NotFound | Forbidden>
  }
>()("rehydra/services/ProjectJoinRequests") {
  static readonly layer = Layer.effect(
    ProjectJoinRequests,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const auth = yield* ProjectAuth
      const activity = yield* Activity

      type Row = {
        readonly id: string
        readonly project_slug: string
        readonly project_name: string
        readonly user_id: string
        readonly display_name: string
        readonly message: string
        readonly created_at: Date | string
      }
      const toRequest = (row: Row): JoinRequest => ({
        id: row.id as Uuid,
        projectSlug: row.project_slug,
        projectName: row.project_name,
        userId: row.user_id as Uuid,
        displayName: row.display_name,
        message: row.message,
        createdAt: toIso(row.created_at)
      })

      const findProject = (projectSlug: string) =>
        sql<{ readonly id: string; readonly checkout_policy: "open" | "members" }>`
          SELECT id, checkout_policy FROM projects
          WHERE slug = ${projectSlug} AND archived_at IS NULL
          LIMIT 1
        `.pipe(
          Effect.orDie,
          Effect.flatMap((rows) => rows[0] === undefined ? Effect.fail(new NotFound()) : Effect.succeed(rows[0]))
        )

      const openForProject = (projectId: string) =>
        sql<Row>`
          SELECT r.id, p.slug AS project_slug, p.name AS project_name, r.user_id, u.display_name,
                 r.message, r.created_at
          FROM join_requests r
          INNER JOIN projects p ON p.id = r.project_id
          INNER JOIN users u ON u.id = r.user_id
          WHERE r.project_id = ${projectId} AND r.state = 'open'
          ORDER BY r.created_at
        `.pipe(Effect.orDie, Effect.map((rows) => rows.map(toRequest)))

      const mineIn = (projectId: string, userId: Uuid) =>
        Effect.gen(function*() {
          const open = yield* sql<Row>`
            SELECT r.id, p.slug AS project_slug, p.name AS project_name, r.user_id, u.display_name,
                   r.message, r.created_at
            FROM join_requests r
            INNER JOIN projects p ON p.id = r.project_id
            INNER JOIN users u ON u.id = r.user_id
            WHERE r.project_id = ${projectId} AND r.user_id = ${userId} AND r.state = 'open'
            LIMIT 1
          `
          const declined = yield* sql<{ readonly retry_after: Date | string }>`
            SELECT resolved_at + make_interval(days => ${RETRY_DAYS}) AS retry_after
            FROM join_requests
            WHERE project_id = ${projectId} AND user_id = ${userId}
              AND state = 'declined'
              AND resolved_at + make_interval(days => ${RETRY_DAYS}) > now()
            ORDER BY resolved_at DESC
            LIMIT 1
          `
          return {
            request: open[0] === undefined ? null : toRequest(open[0]),
            retryAfter: declined[0] === undefined ? null : toIso(declined[0].retry_after)
          } satisfies MyJoinRequestState
        }).pipe(Effect.orDie)

      const mine = Effect.fn("ProjectJoinRequests.mine")(function*(projectSlug: string, userId: Uuid) {
        const project = yield* findProject(projectSlug)
        return yield* mineIn(project.id, userId)
      })

      const create = Effect.fn("ProjectJoinRequests.create")(function*(
        projectSlug: string,
        userId: Uuid,
        payload: JoinRequestPayload
      ) {
        const project = yield* findProject(projectSlug)
        const facts = yield* sql<{ readonly member: boolean; readonly blocked: boolean }>`
          SELECT
            EXISTS (SELECT 1 FROM project_members WHERE project_id = ${project.id} AND user_id = ${userId}) AS member,
            EXISTS (SELECT 1 FROM project_blocks WHERE project_id = ${project.id} AND user_id = ${userId}) AS blocked
        `.pipe(Effect.orDie)
        if (facts[0]?.blocked) {
          return yield* new ProjectAccessDenied({ detail: "You are blocked from this project." })
        }
        if (facts[0]?.member) {
          return yield* new JoinRequestRefused({ detail: "You are already a member of this project." })
        }
        if (project.checkout_policy !== "members") {
          return yield* new JoinRequestRefused({ detail: "This project is open to everyone. You can start working without joining." })
        }
        const state = yield* mineIn(project.id, userId)
        if (state.retryAfter !== null) {
          return yield* new JoinRequestRefused({
            detail: `Your last request was declined. You can ask again after ${new Date(state.retryAfter).toUTCString()}.`
          })
        }
        const inserted = yield* sql<{ readonly id: string }>`
          INSERT INTO join_requests (project_id, user_id, message)
          VALUES (${project.id}, ${userId}, ${(payload.message ?? "").trim()})
          ON CONFLICT (project_id, user_id) WHERE state = 'open' DO NOTHING
          RETURNING id
        `.pipe(Effect.orDie)
        if (inserted[0] === undefined) {
          return yield* new JoinRequestRefused({ detail: "You have already asked to join. A maintainer will answer." })
        }
        return yield* mineIn(project.id, userId)
      })

      const cancel = Effect.fn("ProjectJoinRequests.cancel")(function*(projectSlug: string, userId: Uuid) {
        const project = yield* findProject(projectSlug)
        const updated = yield* sql<{ readonly id: string }>`
          UPDATE join_requests SET state = 'cancelled', resolved_at = now()
          WHERE project_id = ${project.id} AND user_id = ${userId} AND state = 'open'
          RETURNING id
        `.pipe(Effect.orDie)
        if (updated[0] === undefined) return yield* new NotFound()
        return yield* mineIn(project.id, userId)
      })

      const listForProject = Effect.fn("ProjectJoinRequests.listForProject")(function*(
        projectSlug: string,
        actorId: Uuid
      ) {
        const { projectId } = yield* auth.requireRole(projectSlug, actorId, ["owner", "maintainer"])
        return yield* openForProject(projectId)
      })

      const forMe = Effect.fn("ProjectJoinRequests.forMe")(function*(actorId: Uuid) {
        const waiting = yield* sql<Row>`
          SELECT r.id, p.slug AS project_slug, p.name AS project_name, r.user_id, u.display_name,
                 r.message, r.created_at
          FROM join_requests r
          INNER JOIN projects p ON p.id = r.project_id AND p.archived_at IS NULL
          INNER JOIN project_members pm
            ON pm.project_id = r.project_id AND pm.user_id = ${actorId} AND pm.role IN ('owner', 'maintainer')
          INNER JOIN users u ON u.id = r.user_id
          WHERE r.state = 'open'
          ORDER BY r.created_at
        `.pipe(Effect.orDie)
        const yours = yield* sql<Row>`
          SELECT r.id, p.slug AS project_slug, p.name AS project_name, r.user_id, u.display_name,
                 r.message, r.created_at
          FROM join_requests r
          INNER JOIN projects p ON p.id = r.project_id AND p.archived_at IS NULL
          INNER JOIN users u ON u.id = r.user_id
          WHERE r.user_id = ${actorId} AND r.state = 'open'
          ORDER BY r.created_at DESC
        `.pipe(Effect.orDie)
        return { waitingOnYou: waiting.map(toRequest), yours: yours.map(toRequest) } satisfies MyJoinRequests
      })

      const approve = Effect.fn("ProjectJoinRequests.approve")(function*(
        projectSlug: string,
        actorId: Uuid,
        requestId: Uuid
      ) {
        const { projectId } = yield* auth.requireRole(projectSlug, actorId, ["owner", "maintainer"])
        yield* sql.withTransaction(Effect.gen(function*() {
          const rows = yield* sql<{
            readonly user_id: string
            readonly display_name: string
            readonly blocked: boolean
          }>`
            SELECT r.user_id, u.display_name,
              EXISTS (
                SELECT 1 FROM project_blocks b WHERE b.project_id = r.project_id AND b.user_id = r.user_id
              ) AS blocked
            FROM join_requests r
            INNER JOIN users u ON u.id = r.user_id
            WHERE r.id = ${requestId} AND r.project_id = ${projectId} AND r.state = 'open'
            FOR UPDATE OF r
          `
          const request = rows[0]
          if (request === undefined) return yield* new NotFound()
          if (request.blocked) {
            return yield* new ProjectAccessDenied({ detail: "This user is blocked from the project. Lift the block first." })
          }
          const added = yield* sql<{ readonly user_id: string }>`
            INSERT INTO project_members (project_id, user_id, role)
            VALUES (${projectId}, ${request.user_id}, 'contributor')
            ON CONFLICT (project_id, user_id) DO NOTHING
            RETURNING user_id
          `
          yield* sql`
            UPDATE join_requests SET state = 'approved', resolved_at = now(), resolved_by = ${actorId}
            WHERE id = ${requestId}
          `
          if (added[0] !== undefined) {
            yield* activity.record({
              projectId,
              actorId,
              subjectId: request.user_id,
              kind: "members_changed",
              summary: `${request.display_name} joined as contributor`
            })
          }
        })).pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))
        return yield* openForProject(projectId)
      })

      const decline = Effect.fn("ProjectJoinRequests.decline")(function*(
        projectSlug: string,
        actorId: Uuid,
        requestId: Uuid
      ) {
        const { projectId } = yield* auth.requireRole(projectSlug, actorId, ["owner", "maintainer"])
        const updated = yield* sql<{ readonly id: string }>`
          UPDATE join_requests SET state = 'declined', resolved_at = now(), resolved_by = ${actorId}
          WHERE id = ${requestId} AND project_id = ${projectId} AND state = 'open'
          RETURNING id
        `.pipe(Effect.orDie)
        if (updated[0] === undefined) return yield* new NotFound()
        return yield* openForProject(projectId)
      })

      return ProjectJoinRequests.of({ mine, create, cancel, listForProject, forMe, approve, decline })
    })
  )
}
