import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import type { ProjectEventKind } from "../domain/Directory.js"

type RecordEvent = (event: {
  readonly projectId: string
  readonly actorId?: string | null
  readonly kind: ProjectEventKind
  readonly subjectId?: string | null
  readonly summary: string
}) => Effect.Effect<void>

/** Owners and maintainers. One can land a proposal. Two or more means two people. */
export const reviewerCount = (sql: SqlClient, projectId: string) =>
  sql<{ readonly n: number }>`
    SELECT COUNT(*)::int AS n
    FROM project_members
    WHERE project_id = ${projectId}
      AND role IN ('owner', 'maintainer')
  `.pipe(
    Effect.map((rows) => rows[0]?.n ?? 0),
    Effect.orDie
  )

/**
 * Write the next type revision and close the proposal. The caller holds the
 * proposal row and has already decided this reviewer may land it.
 */
export const landProposal = (
  sql: SqlClient,
  record: RecordEvent,
  proposal: {
    readonly id: string
    readonly projectId: string
    readonly headersSha256: Uint8Array
    readonly title: string
    /** null once the author deleted their account. */
    readonly createdBy: string | null
  },
  /** null when the person who started a recheck deleted their account before it finished. */
  reviewerId: string | null
) =>
  Effect.gen(function*() {
    const nextRev = yield* sql<{ readonly revision: number }>`
      SELECT COALESCE(MAX(revision), 0) + 1 AS revision
      FROM type_revisions
      WHERE project_id = ${proposal.projectId}
    `.pipe(Effect.orDie)
    const revision = Number(nextRev[0]?.revision ?? 1)
    const revisionId = randomUUID()

    yield* sql`
      INSERT INTO type_revisions (
        id, project_id, revision, headers_sha256, created_by
      ) VALUES (
        ${revisionId},
        ${proposal.projectId},
        ${revision},
        ${proposal.headersSha256},
        ${proposal.createdBy}
      )
    `.pipe(Effect.orDie)

    yield* sql`
      UPDATE matches m
      SET type_revision_id = ${revisionId}
      FROM chunks c
      WHERE m.chunk_id = c.id
        AND c.project_id = ${proposal.projectId}
        AND c.state = 'matched'
        AND m.invalidated_at IS NULL
    `.pipe(Effect.orDie)

    yield* sql`
      UPDATE chunks
      SET type_revision_id = ${revisionId}, updated_at = now()
      WHERE project_id = ${proposal.projectId}
        AND state = 'matched'
        AND fuse_parent_id IS NULL
    `.pipe(Effect.orDie)

    const landed = yield* sql<{ readonly id: string }>`
      UPDATE type_proposals
      SET
        state = 'accepted',
        resulting_revision_id = ${revisionId},
        reviewed_by = ${reviewerId},
        closed_at = now()
      WHERE id = ${proposal.id}
        AND state IN ('revalidating', 'ready')
      RETURNING id
    `.pipe(Effect.orDie)

    if (landed[0] === undefined) return

    yield* record({
      projectId: proposal.projectId,
      actorId: reviewerId,
      kind: "proposal_accepted",
      subjectId: proposal.id,
      summary: `Accepted type proposal “${proposal.title}”`
    })
  })
