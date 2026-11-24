import { randomUUID } from "node:crypto"
import { PgClient } from "@effect/sql-pg"
import { Context, Effect, Layer } from "effect"
import { BadRequest, Conflict, Forbidden, NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import type { Integration, IntegrationUnit, StartIntegration } from "../domain/Integration.js"
import type { SourceLanguage, Toolchain } from "../domain/Project.js"
import { hideBytes } from "../domain/diagnostics.js"
import { Uuid } from "../domain/Uuid.js"
import { Activity } from "./Activity.js"
import { ProjectAuth } from "./ProjectAuth.js"

type IntegrationRow = {
  readonly id: string
  readonly project_id: string
  readonly binary_id: string
  readonly status: Integration["status"]
  readonly language: string
  readonly toolchain: Toolchain
  readonly toolchain_digest: string | null
  readonly summary: string
  readonly diagnostics: string | null
  readonly created_at: Date | string
  readonly finished_at: Date | string | null
}

type UnitRow = {
  readonly integration_id: string
  readonly chunk_id: string
  readonly name: string
  readonly address: string | number | bigint
  readonly size: number
  readonly passed: boolean | null
  readonly detail: string
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const asLanguage = (value: string): SourceLanguage => (value === "cpp" ? "cpp" : "c")

const toUnit = (row: UnitRow, full: boolean): IntegrationUnit => ({
  chunkId: row.chunk_id,
  name: row.name,
  address: String(row.address),
  size: row.size,
  passed: row.passed,
  detail: full ? row.detail : (hideBytes(row.detail) ?? "")
})

export class IntegrationsRepo extends Context.Service<
  IntegrationsRepo,
  {
    /**
     * Link mismatches quote original bytes. Owners and maintainers see them;
     * everyone else gets the diagnostics with the hex lines removed.
     */
    readonly list: (
      slug: string,
      viewerId: Uuid | null
    ) => Effect.Effect<ReadonlyArray<Integration>, NotFound>
    readonly get: (
      slug: string,
      integrationId: Uuid,
      viewerId: Uuid | null
    ) => Effect.Effect<Integration, NotFound>
    readonly start: (
      slug: string,
      userId: Uuid,
      payload: StartIntegration
    ) => Effect.Effect<Integration, NotFound | Forbidden | BadRequest | Conflict>
  }
>()("rehydra/services/IntegrationsRepo") {
  static readonly layer = Layer.effect(
    IntegrationsRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const pg = yield* PgClient.PgClient
      const auth = yield* ProjectAuth
      const activity = yield* Activity

      const loadUnits = Effect.fn("IntegrationsRepo.loadUnits")(function*(
        ids: ReadonlyArray<string>
      ) {
        if (ids.length === 0) return [] as Array<UnitRow>
        return yield* sql<UnitRow>`
          SELECT integration_id, chunk_id, name, address, size, passed, detail
          FROM integration_units
          WHERE integration_id = ANY(${ids}::uuid[])
          ORDER BY address
        `.pipe(Effect.orDie)
      })

      const toIntegration = (
        row: IntegrationRow,
        units: ReadonlyArray<UnitRow>,
        full: boolean
      ): Integration => ({
        id: row.id,
        projectId: row.project_id,
        binaryId: row.binary_id,
        status: row.status,
        language: asLanguage(row.language),
        toolchain: row.toolchain,
        toolchainDigest: row.toolchain_digest,
        summary: row.summary,
        diagnostics: full ? row.diagnostics : hideBytes(row.diagnostics),
        units: units.filter((unit) => unit.integration_id === row.id).map((unit) => toUnit(unit, full)),
        createdAt: toIso(row.created_at),
        finishedAt: row.finished_at === null ? null : toIso(row.finished_at)
      })

      const requireProject = Effect.fn("IntegrationsRepo.requireProject")(function*(
        slug: string,
        viewerId: Uuid | null
      ) {
        const rows = yield* sql<{ readonly id: string; readonly maintains: boolean }>`
          SELECT
            p.id,
            EXISTS (
              SELECT 1 FROM project_members pm
              WHERE pm.project_id = p.id
                AND pm.user_id = ${viewerId}::uuid
                AND pm.role IN ('owner', 'maintainer')
            ) AS maintains
          FROM projects p
          WHERE p.slug = ${slug} AND p.archived_at IS NULL
          LIMIT 1
        `.pipe(Effect.orDie)
        const row = rows[0]
        if (row === undefined) return yield* new NotFound()
        return { projectId: row.id, full: row.maintains }
      })

      const list = Effect.fn("IntegrationsRepo.list")(function*(slug: string, viewerId: Uuid | null) {
        const { projectId, full } = yield* requireProject(slug, viewerId)
        const rows = yield* sql<IntegrationRow>`
          SELECT
            id, project_id, binary_id, status, language, toolchain,
            toolchain_digest, summary, diagnostics, created_at, finished_at
          FROM integrations
          WHERE project_id = ${projectId}
          ORDER BY created_at DESC
          LIMIT 20
        `.pipe(Effect.orDie)
        const units = yield* loadUnits(rows.map((row) => row.id))
        return rows.map((row) => toIntegration(row, units, full))
      })

      const get = Effect.fn("IntegrationsRepo.get")(function*(
        slug: string,
        integrationId: Uuid,
        viewerId: Uuid | null
      ) {
        const { projectId, full } = yield* requireProject(slug, viewerId)
        const rows = yield* sql<IntegrationRow>`
          SELECT
            id, project_id, binary_id, status, language, toolchain,
            toolchain_digest, summary, diagnostics, created_at, finished_at
          FROM integrations
          WHERE id = ${integrationId} AND project_id = ${projectId}
          LIMIT 1
        `.pipe(Effect.orDie)
        const row = rows[0]
        if (row === undefined) return yield* new NotFound()
        const units = yield* loadUnits([row.id])
        return toIntegration(row, units, full)
      })

      const start = Effect.fn("IntegrationsRepo.start")(function*(
        slug: string,
        userId: Uuid,
        payload: StartIntegration
      ) {
        const { projectId } = yield* auth.requireRole(slug, userId, [
          "owner",
          "maintainer"
        ])

        return yield* sql.withTransaction(Effect.gen(function*() {
          const binaries = yield* sql<{ readonly id: string }>`
            SELECT id FROM binaries
            WHERE project_id = ${projectId}
            ORDER BY created_at
          `
          const binaryId = payload.binaryId ?? binaries[0]?.id
          if (binaryId === undefined || !binaries.some((row) => row.id === binaryId)) {
            return yield* new BadRequest()
          }
          if (payload.binaryId === undefined && binaries.length > 1) {
            return yield* new BadRequest()
          }

          const projectRows = yield* sql<{
            readonly language: string
            readonly toolchain: Toolchain
          }>`
            SELECT language, toolchain FROM projects WHERE id = ${projectId}
          `
          const project = projectRows[0]
          if (project === undefined) return yield* new NotFound()

          const matched = yield* sql<{
            readonly id: string
            readonly name: string
            readonly address: string | number | bigint
            readonly size: number
            readonly language: string
          }>`
            SELECT
              c.id,
              c.name,
              c.address,
              c.size,
              COALESCE(c.language_override, p.language) AS language
            FROM chunks c
            INNER JOIN projects p ON p.id = c.project_id
            WHERE c.binary_id = ${binaryId}
              AND c.project_id = ${projectId}
              AND c.state = 'matched'
              AND c.fuse_parent_id IS NULL
              AND c.current_match_id IS NOT NULL
              AND c.best_attempt_id IS NOT NULL
            ORDER BY c.address
          `

          const distinct = [...new Set(matched.map((row) => asLanguage(row.language)))]
          if (payload.language === undefined && distinct.length !== 1) {
            return yield* new Conflict()
          }
          const language = payload.language ?? distinct[0] ?? asLanguage(project.language)
          const chosen = matched.filter((row) => asLanguage(row.language) === language)
          if (chosen.length < 2) return yield* new Conflict()
          const names = new Set<string>()
          for (const row of chosen) {
            if (names.has(row.name)) return yield* new Conflict()
            names.add(row.name)
          }

          const active = yield* sql<{ readonly id: string }>`
            SELECT id FROM integrations
            WHERE binary_id = ${binaryId}
              AND status IN ('queued', 'running')
            LIMIT 1
          `
          if (active[0] !== undefined) return yield* new Conflict()

          const recipe = yield* sql<{ readonly id: string }>`
            SELECT r.id
            FROM recipe_jobs r
            INNER JOIN chunks c ON c.id = r.chunk_id
            WHERE c.binary_id = ${binaryId}
              AND r.state IN ('queued', 'claimed')
            LIMIT 1
          `
          if (recipe[0] !== undefined) return yield* new Conflict()

          const integrationId = randomUUID()
          const summary = `Linking ${chosen.length} matched functions`
          yield* sql`
            INSERT INTO integrations (
              id, project_id, binary_id, status, started_by,
              language, toolchain, summary
            ) VALUES (
              ${integrationId},
              ${projectId},
              ${binaryId},
              ${"queued"},
              ${userId},
              ${language},
              ${pg.json(project.toolchain)},
              ${summary}
            )
          `

          for (const row of chosen) {
            yield* sql`
              INSERT INTO integration_units (
                integration_id, chunk_id, name, address, size
              ) VALUES (
                ${integrationId},
                ${row.id},
                ${row.name},
                ${row.address},
                ${row.size}
              )
            `
          }

          yield* activity.record({
            projectId,
            actorId: userId,
            kind: "integration_started",
            subjectId: integrationId,
            summary
          })

          return yield* get(slug, integrationId, userId)
        })).pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))
      })

      return IntegrationsRepo.of({ list, get, start })
    })
  )
}
