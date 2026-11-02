import { PgClient } from "@effect/sql-pg"
import { Context, Effect, Layer } from "effect"
import { BadRequest, Conflict, Forbidden, NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import { likeContains } from "../domain/Directory.js"
import type { UpdateProjectSettings } from "../domain/Directory.js"
import type { ProjectMembership } from "../domain/Profile.js"
import type { CreateProjectPayload, ProjectSummary } from "../domain/Project.js"
import { Uuid } from "../domain/Uuid.js"
import { Activity } from "./Activity.js"
import { enqueueRecipeForProject } from "./RecipeJobs.js"

type ProjectRow = {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly home_region: string
  readonly language: string
  readonly toolchain: ProjectSummary["toolchain"]
  readonly lease_hours: number
  readonly max_hold_hours: number
  readonly max_concurrent_leases: number
  readonly follower_count: number
  readonly last_activity_at: Date | string
  readonly created_at: Date | string
  readonly open_count: number | null
  readonly leased_count: number | null
  readonly validating_count: number | null
  readonly matched_count: number | null
  readonly stale_count: number | null
  readonly blocked_count: number | null
  readonly total_count: number | null
}

const toSummary = (row: ProjectRow): ProjectSummary => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  homeRegion: row.home_region,
  language: row.language,
  toolchain: row.toolchain,
  leaseHours: row.lease_hours,
  maxHoldHours: row.max_hold_hours,
  maxConcurrentLeases: row.max_concurrent_leases,
  followerCount: row.follower_count,
  lastActivityAt: row.last_activity_at instanceof Date
    ? row.last_activity_at.toISOString()
    : new Date(row.last_activity_at).toISOString(),
  createdAt: row.created_at instanceof Date
    ? row.created_at.toISOString()
    : new Date(row.created_at).toISOString(),
  stats: {
    open: row.open_count ?? 0,
    leased: row.leased_count ?? 0,
    validating: row.validating_count ?? 0,
    matched: row.matched_count ?? 0,
    stale: row.stale_count ?? 0,
    blocked: row.blocked_count ?? 0,
    total: row.total_count ?? 0
  }
})

export class ProjectsRepo extends Context.Service<
  ProjectsRepo,
  {
    readonly list: (query: {
      readonly q?: string | undefined
      readonly language?: string | undefined
      readonly arch?: string | undefined
    }) => Effect.Effect<ReadonlyArray<ProjectSummary>>
    readonly getBySlug: (slug: string) => Effect.Effect<ProjectSummary, NotFound>
    readonly membership: (
      slug: string,
      userId: Uuid
    ) => Effect.Effect<ProjectMembership, NotFound>
    readonly create: (
      userId: Uuid,
      payload: CreateProjectPayload
    ) => Effect.Effect<ProjectSummary, Conflict | NotFound>
    readonly updateSettings: (
      slug: string,
      userId: Uuid,
      payload: UpdateProjectSettings
    ) => Effect.Effect<ProjectSummary, NotFound | Forbidden | BadRequest>
  }
>()("rehydra/services/ProjectsRepo") {
  static readonly layer = Layer.effect(
    ProjectsRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const pg = yield* PgClient.PgClient
      const activity = yield* Activity

      const list = Effect.fn("ProjectsRepo.list")(function*(query: {
        readonly q?: string | undefined
        readonly language?: string | undefined
        readonly arch?: string | undefined
      }) {
        const pattern = likeContains(query.q)
        const language = query.language?.trim() || null
        const arch = query.arch?.trim() || null
        const rows = yield* sql<ProjectRow>`
          SELECT
            p.id,
            p.slug,
            p.name,
            p.description,
            p.home_region,
            p.language,
            p.toolchain,
            p.lease_hours,
            p.max_hold_hours,
            p.max_concurrent_leases,
            p.created_at,
            COALESCE(
              (SELECT MAX(e.created_at) FROM project_events e WHERE e.project_id = p.id),
              p.created_at
            ) AS last_activity_at,
            (SELECT COUNT(*)::int FROM follows f WHERE f.project_id = p.id) AS follower_count,
            s.open_count,
            s.leased_count,
            s.validating_count,
            s.matched_count,
            s.stale_count,
            s.blocked_count,
            s.total_count
          FROM projects p
          LEFT JOIN project_chunk_stats s ON s.project_id = p.id
          WHERE p.archived_at IS NULL
            AND (
              ${pattern}::text IS NULL
              OR p.name ILIKE ${pattern} ESCAPE '\\'
              OR p.slug::text ILIKE ${pattern} ESCAPE '\\'
              OR p.description ILIKE ${pattern} ESCAPE '\\'
            )
            AND (${language}::text IS NULL OR p.language = ${language})
            AND (
              ${arch}::text IS NULL
              OR EXISTS (
                SELECT 1 FROM binaries b
                WHERE b.project_id = p.id AND b.arch = ${arch}
              )
            )
          ORDER BY last_activity_at DESC
          LIMIT 100
        `.pipe(Effect.orDie)
        return rows.map(toSummary)
      })

      const getBySlug = Effect.fn("ProjectsRepo.getBySlug")(function*(slug: string) {
        const rows = yield* sql<ProjectRow>`
          SELECT
            p.id,
            p.slug,
            p.name,
            p.description,
            p.home_region,
            p.language,
            p.toolchain,
            p.lease_hours,
            p.max_hold_hours,
            p.max_concurrent_leases,
            p.created_at,
            COALESCE(
              (SELECT MAX(e.created_at) FROM project_events e WHERE e.project_id = p.id),
              p.created_at
            ) AS last_activity_at,
            (SELECT COUNT(*)::int FROM follows f WHERE f.project_id = p.id) AS follower_count,
            s.open_count,
            s.leased_count,
            s.validating_count,
            s.matched_count,
            s.stale_count,
            s.blocked_count,
            s.total_count
          FROM projects p
          LEFT JOIN project_chunk_stats s ON s.project_id = p.id
          WHERE p.slug = ${slug}
            AND p.archived_at IS NULL
          LIMIT 1
        `.pipe(Effect.orDie)

        const row = rows[0]
        if (row === undefined) {
          return yield* new NotFound()
        }
        return toSummary(row)
      })

      const membership = Effect.fn("ProjectsRepo.membership")(function*(
        slug: string,
        userId: Uuid
      ) {
        const rows = yield* sql<{
          readonly slug: string
          readonly role: ProjectMembership["role"]
        }>`
          SELECT p.slug, pm.role
          FROM projects p
          INNER JOIN project_members pm
            ON pm.project_id = p.id AND pm.user_id = ${userId}
          WHERE p.slug = ${slug}
            AND p.archived_at IS NULL
          LIMIT 1
        `.pipe(Effect.orDie)

        const row = rows[0]
        if (row === undefined) {
          const exists = yield* sql<{ readonly id: string }>`
            SELECT id FROM projects
            WHERE slug = ${slug} AND archived_at IS NULL
            LIMIT 1
          `.pipe(Effect.orDie)
          if (exists[0] === undefined) {
            return yield* new NotFound()
          }
          return yield* new NotFound()
        }

        return {
          projectSlug: row.slug,
          role: row.role
        } satisfies ProjectMembership
      })

      const create = Effect.fn("ProjectsRepo.create")(
        function*(userId: Uuid, payload: CreateProjectPayload) {
          const leaseHours = payload.leaseHours ?? 24
          const maxHoldHours = payload.maxHoldHours ?? 48
          const maxConcurrentLeases = payload.maxConcurrentLeases ?? 1
          const description = payload.description ?? ""

          const inserted = yield* sql<{ readonly id: string }>`
            INSERT INTO projects (
              slug, name, description, home_region, language, toolchain,
              lease_hours, max_hold_hours, max_concurrent_leases, created_by
            ) VALUES (
              ${payload.slug},
              ${payload.name},
              ${description},
              ${payload.homeRegion},
              ${payload.language},
              ${pg.json(payload.toolchain)},
              ${leaseHours},
              ${maxHoldHours},
              ${maxConcurrentLeases},
              ${userId}
            )
            ON CONFLICT (slug) DO NOTHING
            RETURNING id
          `.pipe(Effect.orDie)

          const projectId = inserted[0]?.id
          if (projectId === undefined) {
            return yield* new Conflict()
          }

          yield* sql`
            INSERT INTO project_members (project_id, user_id, role)
            VALUES (${projectId}, ${userId}, ${"owner"})
          `.pipe(Effect.orDie)

          yield* sql`
            INSERT INTO project_chunk_stats (project_id)
            VALUES (${projectId})
          `.pipe(Effect.orDie)

          return yield* getBySlug(payload.slug)
        }
      )

      const updateSettings = Effect.fn("ProjectsRepo.updateSettings")(function*(
        slug: string,
        userId: Uuid,
        payload: UpdateProjectSettings
      ) {
        if (
          payload.maxConcurrentLeases === undefined &&
          payload.language === undefined &&
          payload.flags === undefined
        ) {
          return yield* new BadRequest()
        }

        const rows = yield* sql<{
          readonly id: string
          readonly role: string | null
          readonly language: string
          readonly toolchain: ProjectSummary["toolchain"]
          readonly max_concurrent_leases: number
        }>`
          SELECT p.id, pm.role, p.language, p.toolchain, p.max_concurrent_leases
          FROM projects p
          LEFT JOIN project_members pm
            ON pm.project_id = p.id AND pm.user_id = ${userId}
          WHERE p.slug = ${slug}
            AND p.archived_at IS NULL
          LIMIT 1
        `.pipe(Effect.orDie)

        const row = rows[0]
        if (row === undefined) {
          return yield* new NotFound()
        }
        if (row.role !== "owner" && row.role !== "maintainer") {
          return yield* new Forbidden()
        }

        const nextLeases = payload.maxConcurrentLeases ?? row.max_concurrent_leases
        let language = payload.language ?? row.language
        let toolchain = {
          ...row.toolchain,
          flags: [...row.toolchain.flags]
        }
        const flagsChanged = payload.flags !== undefined && (
          payload.flags.length !== toolchain.flags.length ||
          payload.flags.some((flag, index) => flag !== toolchain.flags[index])
        )
        if (flagsChanged && payload.flags !== undefined) {
          toolchain = { ...toolchain, flags: [...payload.flags] }
        }
        const languageChanged = payload.language !== undefined && payload.language !== row.language
        if (languageChanged) {
          if (language === "cpp" && toolchain.compiler === "gcc") {
            toolchain = { ...toolchain, compiler: "g++" }
          }
          if (language === "c" && toolchain.compiler === "g++") {
            toolchain = { ...toolchain, compiler: "gcc" }
          }
        }

        const notes: Array<string> = []
        if (payload.maxConcurrentLeases !== undefined) {
          notes.push(`competing leases ${nextLeases}`)
        }
        if (languageChanged) notes.push(`language ${language}`)
        if (flagsChanged) notes.push(`flags ${toolchain.flags.join(" ")}`)
        const recipeChanged = languageChanged || flagsChanged
        if (recipeChanged) notes.push("rechecking matches")

        yield* sql.withTransaction(Effect.gen(function*() {
          yield* sql`
            UPDATE projects
            SET
              max_concurrent_leases = ${nextLeases},
              language = ${language},
              toolchain = ${pg.json(toolchain)},
              updated_at = now()
            WHERE id = ${row.id}
          `
          if (recipeChanged) {
            yield* enqueueRecipeForProject(sql, row.id)
          }
          yield* activity.record({
            projectId: row.id,
            actorId: userId,
            kind: "settings_changed",
            summary: `Updated settings: ${notes.join(", ")}`
          })
        })).pipe(Effect.orDie)

        return yield* getBySlug(slug)
      })

      return ProjectsRepo.of({ list, getBySlug, membership, create, updateSettings })
    })
  )
}
