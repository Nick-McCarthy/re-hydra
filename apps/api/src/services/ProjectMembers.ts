import { Context, Effect, Layer } from "effect"
import { Forbidden, NotFound } from "effect/http-api/HttpApiError"
import { ProjectRefused } from "../domain/Problems.js"
import { SqlClient } from "effect/sql"
import {
  type AddMemberPayload,
  type ChangeRolePayload,
  type OfferOwnershipPayload,
  type OwnershipOffer,
  type OwnershipOfferState,
  ProjectAccessDenied,
  type ProjectMember
} from "../domain/Project.js"
import type { Uuid } from "../domain/Uuid.js"
import { Activity } from "./Activity.js"
import { ProjectAuth } from "./ProjectAuth.js"
import { ChunkState } from "./ChunkState.js"

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

type Members = ReadonlyArray<ProjectMember>

/**
 * Audit A-011: who is a member of a project, and in what role.
 *
 * - The owner adds, promotes, demotes, and removes anyone.
 * - Maintainers add and remove contributors only.
 * - Any member except the owner can leave. The owner hands over ownership
 *   first: an offer the other user accepts, after which the old owner is a
 *   maintainer. One owner per project always (project_members_one_owner).
 * - Blocked users cannot be added or offered ownership (A-012).
 * - Losing membership on a members-only project ends the user's leases there.
 * - Changes are public in the activity feed, with names.
 */
export class ProjectMembers extends Context.Service<
  ProjectMembers,
  {
    readonly list: (projectSlug: string) => Effect.Effect<Members, NotFound>
    readonly add: (
      projectSlug: string,
      actorId: Uuid,
      payload: AddMemberPayload
    ) => Effect.Effect<Members, NotFound | Forbidden | ProjectRefused | ProjectAccessDenied>
    readonly changeRole: (
      projectSlug: string,
      actorId: Uuid,
      targetId: Uuid,
      payload: ChangeRolePayload
    ) => Effect.Effect<Members, NotFound | Forbidden | ProjectAccessDenied>
    readonly remove: (
      projectSlug: string,
      actorId: Uuid,
      targetId: Uuid
    ) => Effect.Effect<Members, NotFound | Forbidden | ProjectAccessDenied>
    readonly getOffer: (
      projectSlug: string,
      actorId: Uuid
    ) => Effect.Effect<OwnershipOfferState, NotFound>
    readonly myOffers: (actorId: Uuid) => Effect.Effect<ReadonlyArray<OwnershipOffer>>
    readonly offer: (
      projectSlug: string,
      actorId: Uuid,
      payload: OfferOwnershipPayload
    ) => Effect.Effect<OwnershipOfferState, NotFound | Forbidden | ProjectRefused | ProjectAccessDenied>
    readonly accept: (
      projectSlug: string,
      actorId: Uuid
    ) => Effect.Effect<Members, NotFound | ProjectAccessDenied>
    readonly withdraw: (
      projectSlug: string,
      actorId: Uuid
    ) => Effect.Effect<OwnershipOfferState, NotFound | Forbidden>
  }
>()("rehydra/services/ProjectMembers") {
  static readonly layer = Layer.effect(
    ProjectMembers,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const auth = yield* ProjectAuth
      const activity = yield* Activity
      const chunkState = yield* ChunkState

      const findProject = (projectSlug: string) =>
        sql<{ readonly id: string; readonly checkout_policy: "open" | "members" }>`
          SELECT id, checkout_policy FROM projects
          WHERE slug = ${projectSlug} AND archived_at IS NULL
          LIMIT 1
        `.pipe(
          Effect.orDie,
          Effect.flatMap((rows) => rows[0] === undefined ? Effect.fail(new NotFound()) : Effect.succeed(rows[0]))
        )

      const loadMembers = (projectId: string) =>
        sql<{
          readonly user_id: string
          readonly display_name: string
          readonly role: ProjectMember["role"]
          readonly created_at: Date | string
        }>`
          SELECT pm.user_id, u.display_name, pm.role, pm.created_at
          FROM project_members pm
          INNER JOIN users u ON u.id = pm.user_id
          WHERE pm.project_id = ${projectId}
          ORDER BY
            CASE pm.role WHEN 'owner' THEN 0 WHEN 'maintainer' THEN 1 ELSE 2 END,
            pm.created_at,
            u.display_name
        `.pipe(
          Effect.orDie,
          Effect.map((rows) =>
            rows.map((row): ProjectMember => ({
              userId: row.user_id as Uuid,
              displayName: row.display_name,
              role: row.role,
              joinedAt: toIso(row.created_at)
            }))
          )
        )

      /** The user, their role here (if any), and whether they are blocked here. */
      const findTarget = (projectId: string, targetId: Uuid) =>
        sql<{
          readonly display_name: string
          readonly role: ProjectMember["role"] | null
          readonly blocked: boolean
        }>`
          SELECT
            u.display_name,
            pm.role,
            EXISTS (
              SELECT 1 FROM project_blocks b
              WHERE b.project_id = ${projectId} AND b.user_id = u.id
            ) AS blocked
          FROM users u
          LEFT JOIN project_members pm ON pm.project_id = ${projectId} AND pm.user_id = u.id
          WHERE u.id = ${targetId}
          LIMIT 1
        `.pipe(
          Effect.orDie,
          Effect.flatMap((rows) => rows[0] === undefined ? Effect.fail(new NotFound()) : Effect.succeed(rows[0]))
        )
      type OfferRow = {
        readonly id: string
        readonly offered_by: string
        readonly offered_to: string
        readonly created_at: Date | string
        readonly expires_at: Date | string
        readonly project_slug: string
        readonly project_name: string
        readonly offered_by_name: string
        readonly offered_to_name: string
      }
      const toOffer = (row: OfferRow): OwnershipOffer => ({
        id: row.id as Uuid,
        projectSlug: row.project_slug,
        projectName: row.project_name,
        offeredBy: row.offered_by as Uuid,
        offeredByName: row.offered_by_name,
        offeredTo: row.offered_to as Uuid,
        offeredToName: row.offered_to_name,
        createdAt: toIso(row.created_at),
        expiresAt: toIso(row.expires_at)
      })

      const loadOpenOffer = (projectId: string) =>
        sql<OfferRow>`
          SELECT
            t.id, t.offered_by, t.offered_to, t.created_at, t.expires_at,
            p.slug AS project_slug, p.name AS project_name,
            ub.display_name AS offered_by_name, ut.display_name AS offered_to_name
          FROM ownership_transfers t
          INNER JOIN projects p ON p.id = t.project_id
          INNER JOIN users ub ON ub.id = t.offered_by
          INNER JOIN users ut ON ut.id = t.offered_to
          WHERE t.project_id = ${projectId}
            AND t.state = 'open'
            AND t.expires_at > now()
          LIMIT 1
        `.pipe(Effect.map((rows) => rows[0] === undefined ? null : toOffer(rows[0])))

      const expireStale = (projectId: string) =>
        sql`
          UPDATE ownership_transfers
          SET state = 'expired', resolved_at = now()
          WHERE project_id = ${projectId} AND state = 'open' AND expires_at <= now()
        `

      const record = (projectId: string, actorId: Uuid, subjectId: Uuid, summary: string) =>
        activity.record({ projectId, actorId, subjectId, kind: "members_changed", summary })

      const list = Effect.fn("ProjectMembers.list")(function*(projectSlug: string) {
        const project = yield* findProject(projectSlug)
        return yield* loadMembers(project.id)
      })

      const add = Effect.fn("ProjectMembers.add")(function*(
        projectSlug: string,
        actorId: Uuid,
        payload: AddMemberPayload
      ) {
        const { projectId, role } = yield* auth.requireRole(projectSlug, actorId, ["owner", "maintainer"])
        if (payload.role === "maintainer" && role !== "owner") {
          return yield* new ProjectAccessDenied({ detail: "Only the owner can add maintainers." })
        }
        const target = yield* findTarget(projectId, payload.userId)
        if (target.role !== null) {
          return yield* new ProjectRefused({ reason: "already_member", detail: `This person is already a ${target.role} of the project.` })
        }
        if (target.blocked) {
          return yield* new ProjectAccessDenied({ detail: "This user is blocked from the project. Lift the block first." })
        }
        const inserted = yield* sql<{ readonly user_id: string }>`
          INSERT INTO project_members (project_id, user_id, role)
          VALUES (${projectId}, ${payload.userId}, ${payload.role})
          ON CONFLICT (project_id, user_id) DO NOTHING
          RETURNING user_id
        `.pipe(Effect.orDie)
        if (inserted[0] === undefined) {
          return yield* new ProjectRefused({ reason: "already_member", detail: "This person is already a member of the project." })
        }
        yield* sql`
          UPDATE join_requests SET state = 'approved', resolved_at = now(), resolved_by = ${actorId}
          WHERE project_id = ${projectId} AND user_id = ${payload.userId} AND state = 'open'
        `.pipe(Effect.orDie)
        yield* record(projectId, actorId, payload.userId, `${target.display_name} joined as ${payload.role}`)
        return yield* loadMembers(projectId)
      })

      const changeRole = Effect.fn("ProjectMembers.changeRole")(function*(
        projectSlug: string,
        actorId: Uuid,
        targetId: Uuid,
        payload: ChangeRolePayload
      ) {
        const { projectId } = yield* auth.requireRole(projectSlug, actorId, ["owner"])
        const target = yield* findTarget(projectId, targetId)
        if (target.role === null) return yield* new NotFound()
        if (target.role === "owner") {
          return yield* new ProjectAccessDenied({ detail: "The owner's role changes only through an ownership transfer." })
        }
        if (target.role !== payload.role) {
          yield* sql`
            UPDATE project_members SET role = ${payload.role}
            WHERE project_id = ${projectId} AND user_id = ${targetId} AND role <> 'owner'
          `.pipe(Effect.orDie)
          yield* record(projectId, actorId, targetId, `${target.display_name} is now a ${payload.role}`)
        }
        // Every role keeps the right to work here, so no leases change.
        return yield* loadMembers(projectId)
      })

      const remove = Effect.fn("ProjectMembers.remove")(function*(
        projectSlug: string,
        actorId: Uuid,
        targetId: Uuid
      ) {
        const leaving = targetId === actorId
        const { projectId, role: actorRole } = yield* auth.requireRole(
          projectSlug,
          actorId,
          leaving ? ["owner", "maintainer", "contributor"] : ["owner", "maintainer"]
        )
        const target = yield* findTarget(projectId, targetId)
        if (target.role === null) return yield* new NotFound()
        if (target.role === "owner") {
          return yield* new ProjectAccessDenied({
            detail: leaving ? "Hand over ownership before leaving." : "The owner cannot be removed."
          })
        }
        if (!leaving && target.role === "maintainer" && actorRole !== "owner") {
          return yield* new ProjectAccessDenied({ detail: "Only the owner can remove maintainers." })
        }
        const project = yield* findProject(projectSlug)

        yield* sql.withTransaction(Effect.gen(function*() {
          const removed = yield* sql<{ readonly user_id: string }>`
            DELETE FROM project_members
            WHERE project_id = ${projectId} AND user_id = ${targetId} AND role <> 'owner'
            RETURNING user_id
          `
          if (removed[0] === undefined) return
          // On a members-only project they can no longer work here.
          if (project.checkout_policy === "members") {
            yield* chunkState.endUserLeases({ userId: targetId, projectId })
          }
          yield* record(
            projectId,
            actorId,
            targetId,
            leaving ? `${target.display_name} left the project` : `${target.display_name} was removed from the project`
          )
        })).pipe(Effect.orDie)

        return yield* loadMembers(projectId)
      })

      const getOffer = Effect.fn("ProjectMembers.getOffer")(function*(projectSlug: string, actorId: Uuid) {
        const project = yield* findProject(projectSlug)
        const offer = yield* loadOpenOffer(project.id).pipe(Effect.orDie)
        const party = offer !== null && (offer.offeredBy === actorId || offer.offeredTo === actorId)
        return { offer: party ? offer : null } satisfies OwnershipOfferState
      })

      const myOffers = Effect.fn("ProjectMembers.myOffers")(function*(actorId: Uuid) {
        const rows = yield* sql<OfferRow>`
          SELECT
            t.id, t.offered_by, t.offered_to, t.created_at, t.expires_at,
            p.slug AS project_slug, p.name AS project_name,
            ub.display_name AS offered_by_name, ut.display_name AS offered_to_name
          FROM ownership_transfers t
          INNER JOIN projects p ON p.id = t.project_id AND p.archived_at IS NULL
          INNER JOIN users ub ON ub.id = t.offered_by
          INNER JOIN users ut ON ut.id = t.offered_to
          WHERE t.offered_to = ${actorId}
            AND t.state = 'open'
            AND t.expires_at > now()
          ORDER BY t.created_at DESC
        `.pipe(Effect.orDie)
        return rows.map(toOffer)
      })

      const offer = Effect.fn("ProjectMembers.offer")(function*(
        projectSlug: string,
        actorId: Uuid,
        payload: OfferOwnershipPayload
      ) {
        const { projectId } = yield* auth.requireRole(projectSlug, actorId, ["owner"])
        if (payload.userId === actorId) {
          return yield* new ProjectAccessDenied({ detail: "You already own this project." })
        }
        const target = yield* findTarget(projectId, payload.userId)
        if (target.blocked) {
          return yield* new ProjectAccessDenied({ detail: "This user is blocked from the project. Lift the block first." })
        }
        const created = yield* sql.withTransaction(Effect.gen(function*() {
          yield* expireStale(projectId)
          const rows = yield* sql<{ readonly id: string }>`
            INSERT INTO ownership_transfers (project_id, offered_by, offered_to)
            VALUES (${projectId}, ${actorId}, ${payload.userId})
            ON CONFLICT (project_id) WHERE state = 'open' DO NOTHING
            RETURNING id
          `
          if (rows[0] === undefined) return false
          yield* record(projectId, actorId, payload.userId, `Ownership offered to ${target.display_name}`)
          return true
        })).pipe(Effect.orDie)
        // One open offer at a time: withdraw the current one first.
        if (!created) {
          return yield* new ProjectRefused({
            reason: "offer_open",
            detail: "An ownership offer is already open. Withdraw it before making another."
          })
        }
        return { offer: yield* loadOpenOffer(projectId).pipe(Effect.orDie) } satisfies OwnershipOfferState
      })

      const accept = Effect.fn("ProjectMembers.accept")(function*(projectSlug: string, actorId: Uuid) {
        const project = yield* findProject(projectSlug)
        const projectId = project.id
        yield* sql.withTransaction(Effect.gen(function*() {
          // Serialise transfers and member changes on this project.
          yield* sql`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`
          yield* expireStale(projectId)
          const offers = yield* sql<{ readonly id: string; readonly offered_by: string }>`
            SELECT id, offered_by FROM ownership_transfers
            WHERE project_id = ${projectId} AND state = 'open' AND offered_to = ${actorId}
            FOR UPDATE
          `
          const open = offers[0]
          if (open === undefined) return yield* new NotFound()
          const target = yield* findTarget(projectId, actorId)
          if (target.blocked) {
            return yield* new ProjectAccessDenied({ detail: "You are blocked from this project." })
          }
          // Demote first: only one owner row may exist at any moment.
          yield* sql`
            UPDATE project_members SET role = 'maintainer'
            WHERE project_id = ${projectId} AND role = 'owner'
          `
          yield* sql`
            INSERT INTO project_members (project_id, user_id, role)
            VALUES (${projectId}, ${actorId}, 'owner')
            ON CONFLICT (project_id, user_id) DO UPDATE SET role = 'owner'
          `
          yield* sql`
            UPDATE ownership_transfers SET state = 'accepted', resolved_at = now()
            WHERE id = ${open.id}
          `
          yield* record(projectId, actorId, actorId, `${target.display_name} is now the owner`)
        })).pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))
        return yield* loadMembers(projectId)
      })

      const withdraw = Effect.fn("ProjectMembers.withdraw")(function*(projectSlug: string, actorId: Uuid) {
        const project = yield* findProject(projectSlug)
        const open = yield* loadOpenOffer(project.id).pipe(Effect.orDie)
        if (open === null) return yield* new NotFound()
        const declining = open.offeredTo === actorId
        if (!declining) {
          // Cancelling needs the current owner.
          yield* auth.requireRole(projectSlug, actorId, ["owner"])
        }
        const updated = yield* sql<{ readonly id: string }>`
          UPDATE ownership_transfers
          SET state = ${declining ? "declined" : "cancelled"}, resolved_at = now()
          WHERE id = ${open.id} AND state = 'open'
          RETURNING id
        `.pipe(Effect.orDie)
        if (updated[0] !== undefined) {
          yield* record(
            project.id,
            actorId,
            open.offeredTo,
            declining
              ? `${open.offeredToName} declined ownership`
              : `Ownership offer to ${open.offeredToName} was withdrawn`
          )
        }
        return { offer: null } satisfies OwnershipOfferState
      })

      return ProjectMembers.of({ list, add, changeRole, remove, getOffer, myOffers, offer, accept, withdraw })
    })
  )
}
