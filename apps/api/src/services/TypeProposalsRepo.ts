import { PgClient } from "@effect/sql-pg"
import { Context, Effect, Layer, Option } from "effect"
import { Conflict, Forbidden, NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import type {
  CreateTypeProposalPayload,
  TypeEnvironment,
  TypeProposal
} from "../domain/Types.js"
import type { Toolchain } from "../domain/Project.js"
import { Uuid } from "../domain/Uuid.js"
import { Activity } from "./Activity.js"
import { Blobs } from "./Blobs.js"
import { landProposal, reviewerCount } from "./ProposalAccept.js"
import { ProjectAuth } from "./ProjectAuth.js"

type ProposalRow = {
  readonly id: string
  readonly project_id: string
  readonly base_revision_id: string
  readonly title: string
  readonly description: string
  readonly affected_types: ReadonlyArray<string> | null
  readonly state: TypeProposal["state"]
  readonly created_by: string
  readonly revalidation_started_by: string | null
  readonly reviewed_by: string | null
  readonly resulting_revision_id: string | null
  readonly revalidation_total: number
  readonly revalidation_done: number
  readonly revalidation_failed: number
  readonly revalidation_unchecked: number
  readonly created_at: Date | string
  readonly closed_at: Date | string | null
  readonly headers_sha256?: Uint8Array
}

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const toProposal = (row: ProposalRow, reviewers: number): TypeProposal => ({
  id: row.id,
  projectId: row.project_id,
  baseRevisionId: row.base_revision_id,
  title: row.title,
  description: row.description,
  state: row.state,
  createdBy: row.created_by,
  ...(row.revalidation_started_by !== null
    ? { revalidationStartedBy: row.revalidation_started_by }
    : {}),
  ...(row.reviewed_by !== null ? { reviewedBy: row.reviewed_by } : {}),
  reviewerCount: reviewers,
  ...(row.resulting_revision_id !== null
    ? { resultingRevisionId: row.resulting_revision_id }
    : {}),
  affectedTypes: row.affected_types ?? [],
  revalidationTotal: row.revalidation_total,
  revalidationDone: row.revalidation_done,
  revalidationFailed: row.revalidation_failed,
  revalidationUnchecked: row.revalidation_unchecked,
  createdAt: toIso(row.created_at),
  ...(row.closed_at !== null ? { closedAt: toIso(row.closed_at) } : {})
})

export class TypeProposalsRepo extends Context.Service<
  TypeProposalsRepo,
  {
    readonly currentEnvironment: (
      projectSlug: string
    ) => Effect.Effect<TypeEnvironment, NotFound>
    readonly list: (
      projectSlug: string
    ) => Effect.Effect<ReadonlyArray<TypeProposal>, NotFound>
    readonly get: (
      projectSlug: string,
      proposalId: Uuid
    ) => Effect.Effect<TypeProposal, NotFound>
    readonly create: (
      projectSlug: string,
      userId: Uuid,
      payload: CreateTypeProposalPayload
    ) => Effect.Effect<TypeProposal, NotFound | Forbidden | Conflict>
    readonly startRevalidation: (
      projectSlug: string,
      proposalId: Uuid,
      userId: Uuid
    ) => Effect.Effect<TypeProposal, NotFound | Forbidden | Conflict>
    readonly accept: (
      projectSlug: string,
      proposalId: Uuid,
      userId: Uuid
    ) => Effect.Effect<TypeProposal, NotFound | Forbidden | Conflict>
  }
>()("rehydra/services/TypeProposalsRepo") {
  static readonly layer = Layer.effect(
    TypeProposalsRepo,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const pg = yield* PgClient.PgClient
      const blobs = yield* Blobs
      const activity = yield* Activity
      const auth = yield* ProjectAuth

      const headersText = Effect.fn("TypeProposalsRepo.headersText")(
        function*(sha: Uint8Array | undefined) {
          if (sha === undefined) {
            return undefined
          }
          const bytes = yield* blobs.get(sha)
          if (Option.isNone(bytes)) {
            return undefined
          }
          return Buffer.from(bytes.value).toString("utf8")
        }
      )

      const withHeaders = Effect.fn("TypeProposalsRepo.withHeaders")(
        function*(row: ProposalRow) {
          const headers = yield* headersText(row.headers_sha256)
          const reviewers = yield* reviewerCount(sql, row.project_id)
          const proposal = toProposal(row, reviewers)
          return headers === undefined ? proposal : { ...proposal, headers }
        }
      )

      const currentEnvironment = Effect.fn("TypeProposalsRepo.currentEnvironment")(
        function*(projectSlug: string) {
          const projects = yield* sql<{ readonly id: string }>`
            SELECT id FROM projects
            WHERE slug = ${projectSlug} AND archived_at IS NULL
            LIMIT 1
          `.pipe(Effect.orDie)
          const projectId = projects[0]?.id
          if (projectId === undefined) {
            return yield* new NotFound()
          }

          const revisions = yield* sql<{
            readonly revision: number
            readonly headers_sha256: Uint8Array
            readonly created_at: Date | string
          }>`
            SELECT revision, headers_sha256, created_at
            FROM type_revisions
            WHERE project_id = ${projectId}
            ORDER BY revision DESC
            LIMIT 1
          `.pipe(Effect.orDie)
          const revision = revisions[0]
          if (revision === undefined) {
            return yield* new NotFound()
          }
          const headers = yield* headersText(revision.headers_sha256)
          if (headers === undefined) {
            return yield* new NotFound()
          }

          const names = yield* sql<{ readonly type_name: string }>`
            SELECT DISTINCT ctr.type_name
            FROM chunk_type_refs ctr
            INNER JOIN chunks c ON c.id = ctr.chunk_id
            WHERE c.project_id = ${projectId}
            ORDER BY ctr.type_name
          `.pipe(Effect.orDie)

          return {
            revision: Number(revision.revision),
            headers,
            createdAt: toIso(revision.created_at),
            typeNames: names.map((row) => row.type_name)
          } satisfies TypeEnvironment
        }
      )

      const list = Effect.fn("TypeProposalsRepo.list")(function*(
        projectSlug: string
      ) {
        const projects = yield* sql<{ readonly id: string }>`
          SELECT id FROM projects
          WHERE slug = ${projectSlug} AND archived_at IS NULL
          LIMIT 1
        `.pipe(Effect.orDie)
        if (projects[0] === undefined) {
          return yield* new NotFound()
        }
        const rows = yield* sql<ProposalRow>`
          SELECT *
          FROM type_proposals
          WHERE project_id = ${projects[0].id}
          ORDER BY created_at DESC
        `.pipe(Effect.orDie)
        const reviewers = yield* reviewerCount(sql, projects[0].id)
        return rows.map((row) => toProposal(row, reviewers))
      })

      const get = Effect.fn("TypeProposalsRepo.get")(function*(
        projectSlug: string,
        proposalId: Uuid
      ) {
        const rows = yield* sql<ProposalRow>`
          SELECT tp.*
          FROM type_proposals tp
          INNER JOIN projects p ON p.id = tp.project_id
          WHERE p.slug = ${projectSlug}
            AND tp.id = ${proposalId}
            AND p.archived_at IS NULL
          LIMIT 1
        `.pipe(Effect.orDie)
        const row = rows[0]
        if (row === undefined) {
          return yield* new NotFound()
        }
        return yield* withHeaders(row)
      })

      const create = Effect.fn("TypeProposalsRepo.create")(function*(
        projectSlug: string,
        userId: Uuid,
        payload: CreateTypeProposalPayload
      ) {
        const { projectId } = yield* auth.requireRole(projectSlug, userId, [
          "owner",
          "maintainer",
          "contributor"
        ])

        const revisions = yield* sql<{ readonly id: string }>`
          SELECT id FROM type_revisions
          WHERE project_id = ${projectId}
          ORDER BY revision DESC
          LIMIT 1
        `.pipe(Effect.orDie)
        const baseRevisionId = revisions[0]?.id
        if (baseRevisionId === undefined) {
          return yield* new Conflict()
        }

        const headersSha = yield* blobs.put(
          Buffer.from(payload.headers, "utf8"),
          "text/x-c"
        )
        const affected = payload.affectedTypes ?? []

        const rows = yield* sql<ProposalRow>`
          INSERT INTO type_proposals (
            project_id, base_revision_id, headers_sha256,
            title, description, affected_types, created_by
          ) VALUES (
            ${projectId},
            ${baseRevisionId},
            ${headersSha},
            ${payload.title},
            ${payload.description ?? ""},
            ${affected},
            ${userId}
          )
          RETURNING *
        `.pipe(Effect.orDie)

        const row = rows[0]
        if (row === undefined) {
          return yield* new Conflict()
        }
        yield* activity.record({
          projectId,
          actorId: userId,
          kind: "proposal_opened",
          subjectId: row.id,
          summary: `Opened type proposal “${row.title}”`
        })
        return yield* withHeaders(row)
      })

      const startRevalidation = Effect.fn("TypeProposalsRepo.startRevalidation")(
        function*(projectSlug: string, proposalId: Uuid, userId: Uuid) {
          const { projectId } = yield* auth.requireRole(projectSlug, userId, [
            "owner",
            "maintainer"
          ])

          return yield* sql.withTransaction(Effect.gen(function*() {
            const proposals = yield* sql<ProposalRow>`
              SELECT * FROM type_proposals
              WHERE id = ${proposalId} AND project_id = ${projectId}
              FOR UPDATE
            `

            const proposal = proposals[0]
            if (proposal === undefined) {
              return yield* new NotFound()
            }
            if (proposal.state !== "open") {
              return yield* new Conflict()
            }

            const affected = proposal.affected_types ?? []
            const targets = affected.length === 0
              ? yield* sql<{
                readonly chunk_id: string
                readonly name: string
                readonly language: string
                readonly bytes_sha256: Uint8Array
                readonly best_attempt_id: string
                readonly source_sha256: Uint8Array
                readonly toolchain: Toolchain
                readonly headers_sha256: Uint8Array
              }>`
                SELECT
                  c.id AS chunk_id,
                  c.name,
                  COALESCE(c.language_override, p.language) AS language,
                  c.bytes_sha256,
                  c.best_attempt_id,
                  a.source_sha256,
                  p.toolchain,
                  tp.headers_sha256
                FROM chunks c
                INNER JOIN projects p ON p.id = c.project_id
                INNER JOIN attempts a ON a.id = c.best_attempt_id
                INNER JOIN type_proposals tp ON tp.id = ${proposalId}
                WHERE c.project_id = ${projectId}
                  AND c.state = 'matched'
                  AND c.fuse_parent_id IS NULL
                  AND c.current_match_id IS NOT NULL
                  AND c.best_attempt_id IS NOT NULL
              `
              : yield* sql<{
                readonly chunk_id: string
                readonly name: string
                readonly language: string
                readonly bytes_sha256: Uint8Array
                readonly best_attempt_id: string
                readonly source_sha256: Uint8Array
                readonly toolchain: Toolchain
                readonly headers_sha256: Uint8Array
              }>`
                SELECT DISTINCT
                  c.id AS chunk_id,
                  c.name,
                  COALESCE(c.language_override, p.language) AS language,
                  c.bytes_sha256,
                  c.best_attempt_id,
                  a.source_sha256,
                  p.toolchain,
                  tp.headers_sha256
                FROM chunks c
                INNER JOIN projects p ON p.id = c.project_id
                INNER JOIN attempts a ON a.id = c.best_attempt_id
                INNER JOIN chunk_type_refs ctr ON ctr.chunk_id = c.id
                INNER JOIN type_proposals tp ON tp.id = ${proposalId}
                WHERE c.project_id = ${projectId}
                  AND c.state = 'matched'
                  AND c.fuse_parent_id IS NULL
                  AND c.current_match_id IS NOT NULL
                  AND c.best_attempt_id IS NOT NULL
                  AND ctr.type_name = ANY(${affected})
              `

            yield* sql`
              UPDATE type_proposals
              SET
                state = 'revalidating',
                revalidation_started_by = ${userId},
                revalidation_total = ${targets.length},
                revalidation_done = 0,
                revalidation_failed = 0,
                revalidation_unchecked = 0
              WHERE id = ${proposalId}
            `

            for (const target of targets) {
              yield* sql`
                INSERT INTO jobs (
                  project_id, chunk_id, attempt_id, proposal_id, kind, state,
                  priority, toolchain, language, entry_symbol,
                  original_sha256, sources
                ) VALUES (
                  ${projectId},
                  ${target.chunk_id},
                  ${target.best_attempt_id},
                  ${proposalId},
                  ${"revalidation"},
                  ${"queued"},
                  ${100},
                  ${pg.json(target.toolchain)},
                  ${target.language},
                  ${target.name},
                  ${target.bytes_sha256},
                  ${pg.json([
                    {
                      path: "candidate.c",
                      sha256: Buffer.from(target.source_sha256).toString("hex")
                    },
                    {
                      path: "types.h",
                      sha256: Buffer.from(target.headers_sha256).toString("hex")
                    }
                  ])}
                )
              `
            }

            if (targets.length === 0) {
              const sha = proposal.headers_sha256
              if (sha === undefined) {
                return yield* new Conflict()
              }
              const reviewers = yield* reviewerCount(sql, projectId)
              if (reviewers >= 2) {
                yield* sql`
                  UPDATE type_proposals
                  SET state = 'ready'
                  WHERE id = ${proposalId}
                    AND state = 'revalidating'
                `
                yield* activity.record({
                  projectId,
                  actorId: userId,
                  kind: "proposal_ready",
                  subjectId: proposalId,
                  summary: `Type proposal “${proposal.title}” is ready for another maintainer`
                })
              } else {
                yield* landProposal(
                  sql,
                  (event) => activity.record(event),
                  {
                    id: proposalId,
                    projectId,
                    headersSha256: sha,
                    title: proposal.title,
                    createdBy: proposal.created_by
                  },
                  userId
                )
              }
            }

            const updated = yield* sql<ProposalRow>`
              SELECT * FROM type_proposals WHERE id = ${proposalId} LIMIT 1
            `
            const row = updated[0]
            if (row === undefined) {
              return yield* new NotFound()
            }
            return yield* withHeaders(row)
          })).pipe(Effect.catchTag("SqlError", (e) => Effect.die(e)))
        }
      )

      const accept = Effect.fn("TypeProposalsRepo.accept")(function*(
        projectSlug: string,
        proposalId: Uuid,
        userId: Uuid
      ) {
        const { projectId } = yield* auth.requireRole(projectSlug, userId, [
          "owner",
          "maintainer"
        ])

        return yield* sql.withTransaction(Effect.gen(function*() {
          const proposals = yield* sql<ProposalRow>`
            SELECT * FROM type_proposals
            WHERE id = ${proposalId} AND project_id = ${projectId}
            FOR UPDATE
          `
          const proposal = proposals[0]
          if (proposal === undefined) {
            return yield* new NotFound()
          }
          if (proposal.state !== "ready") {
            return yield* new Conflict()
          }
          const reviewers = yield* reviewerCount(sql, projectId)
          if (
            reviewers >= 2 &&
            proposal.revalidation_started_by === userId
          ) {
            return yield* new Conflict()
          }
          const sha = proposal.headers_sha256
          if (sha === undefined) {
            return yield* new Conflict()
          }
          yield* landProposal(
            sql,
            (event) => activity.record(event),
            {
              id: proposalId,
              projectId,
              headersSha256: sha,
              title: proposal.title,
              createdBy: proposal.created_by
            },
            userId
          )
          const updated = yield* sql<ProposalRow>`
            SELECT * FROM type_proposals WHERE id = ${proposalId} LIMIT 1
          `
          const row = updated[0]
          if (row === undefined) {
            return yield* new NotFound()
          }
          return yield* withHeaders(row)
        })).pipe(Effect.catchTag("SqlError", (e) => Effect.die(e)))
      })

      return TypeProposalsRepo.of({
        currentEnvironment,
        list,
        get,
        create,
        startRevalidation,
        accept
      })
    })
  )
}
