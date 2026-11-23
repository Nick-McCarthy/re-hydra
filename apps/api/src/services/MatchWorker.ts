import { PgClient } from "@effect/sql-pg"
import { Cause, Config, Effect, Layer, Option } from "effect"
import { SqlClient } from "effect/sql"
import { Activity } from "./Activity.js"
import { Blobs } from "./Blobs.js"
import { MatchdClient } from "./MatchdClient.js"
import { landProposal, reviewerCount } from "./ProposalAccept.js"
import { ProjectChunkStats } from "./ProjectChunkStats.js"
import { isPinnedDigest } from "./ToolchainPin.js"

type JobRow = {
  readonly id: string
  readonly attempt_id: string | null
  readonly proposal_id: string | null
  readonly chunk_id: string
  readonly project_id: string
  readonly kind: "interactive" | "revalidation"
  readonly entry_symbol: string
  readonly language: string
  readonly toolchain: {
    readonly compiler: string
    readonly version: string
    readonly flags: ReadonlyArray<string>
    readonly image: string
  }
  readonly original_sha256: Uint8Array
}

type AttemptMeta = {
  readonly id: string
  readonly user_id: string
  readonly type_revision_id: string
  readonly language: string
  readonly source_sha256: Uint8Array
  readonly lease_token: string
}

type ArchRow = {
  readonly arch: string
}

/**
 * Claims queued jobs and runs them against matchd (compile + normalized compare).
 */
export const MatchWorkerLive = Layer.effectDiscard(Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const pg = yield* PgClient.PgClient
  const blobs = yield* Blobs
  const matchd = yield* MatchdClient
  const stats = yield* ProjectChunkStats
  const activity = yield* Activity

  const loadArch = (chunkId: string) =>
    sql<ArchRow>`
      SELECT b.arch
      FROM chunks c
      INNER JOIN binaries b ON b.id = c.binary_id
      WHERE c.id = ${chunkId}
      LIMIT 1
    `.pipe(Effect.orDie)

  const finalizeProposalIfDone = (proposalId: string) =>
    Effect.gen(function*() {
      const rows = yield* sql<{
        readonly project_id: string
        readonly headers_sha256: Uint8Array
        readonly created_by: string
        readonly revalidation_started_by: string | null
        readonly title: string
        readonly revalidation_total: number
        readonly revalidation_done: number
        readonly revalidation_failed: number
        readonly state: string
      }>`
        SELECT
          project_id, headers_sha256, created_by, revalidation_started_by, title,
          revalidation_total, revalidation_done, revalidation_failed, state
        FROM type_proposals
        WHERE id = ${proposalId}
        FOR UPDATE
      `.pipe(Effect.orDie)

      const proposal = rows[0]
      if (proposal === undefined || proposal.state !== "revalidating") {
        return
      }
      const finished =
        proposal.revalidation_done + proposal.revalidation_failed
      if (finished < proposal.revalidation_total) {
        return
      }

      const reviewers = yield* reviewerCount(sql, proposal.project_id)
      const starter = proposal.revalidation_started_by ?? proposal.created_by
      if (reviewers >= 2) {
        const marked = yield* sql<{ readonly id: string }>`
          UPDATE type_proposals
          SET state = 'ready'
          WHERE id = ${proposalId}
            AND state = 'revalidating'
          RETURNING id
        `.pipe(Effect.orDie)
        if (marked[0] === undefined) return
        yield* activity.record({
          projectId: proposal.project_id,
          actorId: starter,
          kind: "proposal_ready",
          subjectId: proposalId,
          summary: `Type proposal “${proposal.title}” is ready for another maintainer`
        })
        return
      }

      yield* landProposal(
        sql,
        (event) => activity.record(event),
        {
          id: proposalId,
          projectId: proposal.project_id,
          headersSha256: proposal.headers_sha256,
          title: proposal.title,
          createdBy: proposal.created_by
        },
        starter
      )
    })

  const processRecipe = Effect.gen(function*() {
    const claimed = yield* sql<{
      readonly id: string
      readonly project_id: string
      readonly chunk_id: string
      readonly attempt_id: string
      readonly language: string
      readonly toolchain: JobRow["toolchain"]
      readonly entry_symbol: string
      readonly original_sha256: Uint8Array
    }>`
      UPDATE recipe_jobs
      SET
        state = 'claimed',
        claimed_by = ${"api-match-worker"},
        claim_expires_at = now() + interval '2 minutes'
      WHERE id = (
        SELECT id FROM recipe_jobs
        WHERE state = 'queued'
           OR (state = 'claimed' AND claim_expires_at < now())
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING
        id, project_id, chunk_id, attempt_id, language, toolchain,
        entry_symbol, original_sha256
    `
    const recipe = claimed[0]
    if (recipe === undefined) return false

    // Only a run that still holds the claim writes a result (audit A-022).
    const fail = (error: string) =>
      sql`
        UPDATE recipe_jobs
        SET state = 'failed', finished_at = now(), result = ${pg.json({ error })}
        WHERE id = ${recipe.id}
          AND state = 'claimed'
      `

    // An error after the claim ends this recheck instead of leaving it
    // `claimed` to fail again every 2 minutes (audit A-022).
    return yield* Effect.gen(function*() {
      const attempts = yield* sql<{
        readonly source_sha256: Uint8Array
      }>`
        SELECT source_sha256 FROM attempts WHERE id = ${recipe.attempt_id} LIMIT 1
      `
      const sourceSha = attempts[0]?.source_sha256
      if (sourceSha === undefined) {
        yield* fail("source missing")
        return true
      }
      const sourceOpt = yield* blobs.get(sourceSha)
      const originalOpt = yield* blobs.get(recipe.original_sha256)
      if (Option.isNone(sourceOpt) || Option.isNone(originalOpt)) {
        yield* fail("source missing")
        return true
      }

      const headerRows = yield* sql<{ readonly headers_sha256: Uint8Array | null }>`
        SELECT tr.headers_sha256
        FROM chunks c
        LEFT JOIN type_revisions tr ON tr.id = c.type_revision_id
        WHERE c.id = ${recipe.chunk_id}
        LIMIT 1
      `
      let typesText = "/* empty */\n"
      const headersSha = headerRows[0]?.headers_sha256
      if (headersSha != null) {
        const headersOpt = yield* blobs.get(headersSha)
        if (Option.isSome(headersOpt)) {
          typesText = Buffer.from(headersOpt.value).toString("utf8")
        }
      }

      const archRows = yield* loadArch(recipe.chunk_id)
      const language = recipe.language === "cpp" ? "cpp" : "c"
      const pinRows = yield* sql<{ readonly toolchain_digest: string }>`
        SELECT m.toolchain_digest
        FROM chunks c
        INNER JOIN matches m ON m.id = c.current_match_id
        WHERE c.id = ${recipe.chunk_id}
        LIMIT 1
      `
      const expectedDigest = pinRows[0]?.toolchain_digest
      const matchResult = yield* matchd.runJob({
        jobId: recipe.id,
        arch: archRows[0]?.arch ?? "x86_64",
        language,
        toolchain: recipe.toolchain,
        flags: recipe.toolchain.flags,
        ...(isPinnedDigest(expectedDigest) ? { expectedToolchainDigest: expectedDigest } : {}),
        entrySymbol: recipe.entry_symbol,
        originalBytesBase64: Buffer.from(originalOpt.value).toString("base64"),
        sources: [
          { path: language === "cpp" ? "candidate.cpp" : "candidate.c", text: Buffer.from(sourceOpt.value).toString("utf8") },
          { path: "types.h", text: typesText }
        ]
      }).pipe(
        Effect.catch((err) =>
          Effect.succeed({
            jobId: recipe.id,
            matched: false,
            score: 0,
            originalInsns: 0,
            equalInsns: 0,
            compilerOk: false,
            diagnostics: `matchd error: ${String(err)}`,
            toolchainDigest: "unavailable",
            canonicalSha256: "0".repeat(64)
          })
        )
      )

      if (!matchResult.compilerOk) {
        yield* fail(matchResult.diagnostics)
        return true
      }

      // One transaction, applied once, and only to the match this recheck was
      // queued for (audit A-022). If the chunk was matched again by a newer
      // attempt since, this result leaves that match alone.
      yield* sql.withTransaction(Effect.gen(function*() {
        const finished = yield* sql<{ readonly id: string }>`
          UPDATE recipe_jobs
          SET state = 'succeeded', finished_at = now(), result = ${pg.json(matchResult)}
          WHERE id = ${recipe.id}
            AND state = 'claimed'
          RETURNING id
        `
        if (finished[0] === undefined) return

        const current = yield* sql<{ readonly match_id: string }>`
          SELECT m.id AS match_id
          FROM chunks c
          INNER JOIN matches m ON m.id = c.current_match_id
          WHERE c.id = ${recipe.chunk_id}
            AND c.state = 'matched'
            AND m.attempt_id = ${recipe.attempt_id}
            AND m.invalidated_at IS NULL
          FOR UPDATE OF c
        `
        const matchId = current[0]?.match_id
        if (matchId === undefined) return

        if (matchResult.matched) {
          yield* sql`
            UPDATE matches
            SET toolchain_digest = ${matchResult.toolchainDigest}, language = ${language}
            WHERE id = ${matchId}
          `
          return
        }

        yield* sql`
          UPDATE matches
          SET
            invalidated_at = now(),
            invalidated_reason = ${"compiler recipe changed"}
          WHERE id = ${matchId}
        `
        yield* sql`
          UPDATE chunks
          SET
            state = 'stale',
            current_match_id = NULL,
            lease_user_id = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            hold_started_at = NULL,
            updated_at = now()
          WHERE id = ${recipe.chunk_id}
            AND state = 'matched'
        `
        yield* stats.refresh(recipe.project_id)
        yield* activity.record({
          projectId: recipe.project_id,
          kind: "became_stale",
          chunkId: recipe.chunk_id,
          summary: `${recipe.entry_symbol} went stale after the compiler recipe changed`
        })
      }))
      return true
    }).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        (cause) =>
          Effect.logWarning(`recipe recheck ${recipe.id} failed`, cause).pipe(
            Effect.andThen(fail(`internal error: ${Cause.pretty(cause).slice(0, 2000)}`)),
            Effect.as(true)
          )
      )
    )
  })

  /**
   * A job's result applies once. Only the run that moves the job from
   * `claimed` to a finished state writes chunk, attempt, or proposal rows.
   * A second run of the same job (its claim expired while the first was still
   * compiling) finds the job finished and changes nothing (audit A-001, I8).
   */
  const finishJob = (jobId: string, state: "succeeded" | "failed", result: unknown) =>
    sql<{ readonly id: string }>`
      UPDATE jobs
      SET state = ${state}, finished_at = now(), result = ${pg.json(result)}
      WHERE id = ${jobId}
        AND state = 'claimed'
      RETURNING id
    `.pipe(Effect.orDie, Effect.map((rows) => rows[0] !== undefined))

  /**
   * Return a `validating` chunk to its holder when its job ends without a
   * result. Nothing else releases `validating` (audit A-004, I11). The lease
   * keeps its expiry, or gets a fresh one if none was stored.
   */
  const releaseValidating = (chunkId: string, jobId: string, leaseToken: string | null) =>
    sql<{ readonly id: string }>`
      UPDATE chunks AS c
      SET
        state = 'leased',
        lease_expires_at = COALESCE(
          c.lease_expires_at,
          now() + make_interval(hours => p.lease_hours)
        ),
        updated_at = now()
      FROM projects p
      WHERE c.id = ${chunkId}
        AND c.project_id = p.id
        AND c.state = 'validating'
        AND (${leaseToken}::uuid IS NULL OR c.lease_token = ${leaseToken}::uuid)
        AND NOT EXISTS (
          SELECT 1 FROM jobs j
          WHERE j.chunk_id = c.id
            AND j.kind = 'interactive'
            AND j.state IN ('queued', 'claimed')
            AND j.id <> ${jobId}
        )
      RETURNING c.id
    `.pipe(Effect.orDie)

  /**
   * End a job that produced no compile result: inputs missing, or an error
   * while committing. An interactive job hands the chunk back to its holder
   * with the reason as diagnostics. A recheck keeps the match and counts as
   * done, the same as a compiler failure (audit A-005).
   */
  const failJob = (job: JobRow, reason: string) =>
    sql.withTransaction(Effect.gen(function*() {
      const finished = yield* finishJob(job.id, "failed", { error: reason })
      if (!finished) return

      if (job.kind === "revalidation") {
        if (job.proposal_id !== null) {
          yield* sql`
            UPDATE type_proposals
            SET revalidation_done = revalidation_done + 1
            WHERE id = ${job.proposal_id}
          `.pipe(Effect.orDie)
          yield* finalizeProposalIfDone(job.proposal_id)
        }
        return
      }

      let leaseToken: string | null = null
      if (job.attempt_id !== null) {
        const attempts = yield* sql<{ readonly lease_token: string }>`
          UPDATE attempts
          SET
            score = 0,
            matched = false,
            compiler_ok = false,
            diagnostics = ${reason},
            finished_at = now()
          WHERE id = ${job.attempt_id}
            AND finished_at IS NULL
          RETURNING lease_token
        `.pipe(Effect.orDie)
        leaseToken = attempts[0]?.lease_token ?? null
      }
      const released = yield* releaseValidating(job.chunk_id, job.id, leaseToken)
      if (released[0] !== undefined) {
        yield* stats.refresh(job.project_id)
      }
    })).pipe(Effect.orDie)

  const runJob = (job: JobRow) => Effect.gen(function*() {
    if (job.attempt_id === null) {
      yield* failJob(job, "attempt missing")
      return true
    }

    const attempts = yield* sql<AttemptMeta>`
      SELECT id, user_id, type_revision_id, language, source_sha256, lease_token
      FROM attempts
      WHERE id = ${job.attempt_id}
      LIMIT 1
    `

    const attempt = attempts[0]
    if (attempt === undefined) {
      yield* failJob(job, "attempt missing")
      return true
    }

    const sourceOpt = yield* blobs.get(attempt.source_sha256)
    if (Option.isNone(sourceOpt)) {
      yield* failJob(job, "source blob missing")
      return true
    }
    const sourceText = Buffer.from(sourceOpt.value).toString("utf8")

    const originalOpt = yield* blobs.get(job.original_sha256)
    if (Option.isNone(originalOpt)) {
      yield* failJob(job, "original bytes missing")
      return true
    }

    let typesText = "/* empty */\n"
    if (job.kind === "revalidation" && job.proposal_id !== null) {
      const proposals = yield* sql<{ readonly headers_sha256: Uint8Array }>`
        SELECT headers_sha256 FROM type_proposals WHERE id = ${job.proposal_id}
      `
      const headersSha = proposals[0]?.headers_sha256
      if (headersSha !== undefined) {
        const headersOpt = yield* blobs.get(headersSha)
        if (Option.isSome(headersOpt)) {
          typesText = Buffer.from(headersOpt.value).toString("utf8")
        }
      }
    } else {
      const revisions = yield* sql<{ readonly headers_sha256: Uint8Array }>`
        SELECT headers_sha256
        FROM type_revisions
        WHERE id = ${attempt.type_revision_id}
        LIMIT 1
      `
      const headersSha = revisions[0]?.headers_sha256
      if (headersSha !== undefined) {
        const headersOpt = yield* blobs.get(headersSha)
        if (Option.isSome(headersOpt)) {
          typesText = Buffer.from(headersOpt.value).toString("utf8")
        }
      }
    }

    const archRows = yield* loadArch(job.chunk_id)
    const arch = archRows[0]?.arch ?? "x86_64"
    const language = job.language === "cpp" ? "cpp" : "c"
    const pinRows = yield* sql<{ readonly toolchain_digest: string }>`
      SELECT m.toolchain_digest
      FROM chunks c
      INNER JOIN matches m ON m.id = c.current_match_id
      WHERE c.id = ${job.chunk_id}
      LIMIT 1
    `
    const expectedDigest = pinRows[0]?.toolchain_digest

    const matchResult = yield* matchd.runJob({
      jobId: job.id,
      arch,
      language,
      toolchain: job.toolchain,
      flags: job.toolchain.flags,
      ...(isPinnedDigest(expectedDigest) ? { expectedToolchainDigest: expectedDigest } : {}),
      entrySymbol: job.entry_symbol,
      originalBytesBase64: Buffer.from(originalOpt.value).toString("base64"),
      sources: [
        { path: language === "cpp" ? "candidate.cpp" : "candidate.c", text: sourceText },
        { path: "types.h", text: typesText }
      ]
    }).pipe(
      Effect.catch((err) =>
        Effect.succeed({
          jobId: job.id,
          matched: false,
          score: 0,
          originalInsns: 0,
          equalInsns: 0,
          compilerOk: false,
          diagnostics: `matchd error: ${String(err)}`,
          toolchainDigest: "unavailable",
          canonicalSha256: "0".repeat(64)
        })
      )
    )

    const canonical = Buffer.from(matchResult.canonicalSha256, "hex")
    const canonicalBytes = canonical.byteLength === 32
      ? canonical
      : Buffer.from(matchResult.canonicalSha256, "utf8")

    if (job.kind === "revalidation" && job.proposal_id !== null) {
      const proposalId = job.proposal_id
      yield* sql.withTransaction(Effect.gen(function*() {
        const finished = yield* finishJob(
          job.id,
          matchResult.compilerOk ? "succeeded" : "failed",
          matchResult
        )
        if (!finished) return

        if (!matchResult.compilerOk || matchResult.matched) {
          // A compiler failure keeps the match, so it counts as done (A-005).
          yield* sql`
            UPDATE type_proposals
            SET revalidation_done = revalidation_done + 1
            WHERE id = ${proposalId}
          `
          if (matchResult.matched) {
            yield* sql`
              UPDATE matches
              SET toolchain_digest = ${matchResult.toolchainDigest}
              WHERE id = (
                SELECT current_match_id FROM chunks
                WHERE id = ${job.chunk_id} AND state = 'matched'
              )
                AND invalidated_at IS NULL
            `
          }
        } else {
          yield* sql`
            UPDATE matches
            SET
              invalidated_at = now(),
              invalidated_reason = ${"type proposal revalidation failed"}
            WHERE chunk_id = ${job.chunk_id}
              AND invalidated_at IS NULL
          `
          yield* sql`
            UPDATE chunks
            SET
              state = 'stale',
              current_match_id = NULL,
              lease_user_id = NULL,
              lease_token = NULL,
              lease_expires_at = NULL,
              hold_started_at = NULL,
              updated_at = now()
            WHERE id = ${job.chunk_id}
              AND state = 'matched'
          `
          yield* stats.refresh(job.project_id)
          const regressions = yield* sql<{ readonly caused_by: string }>`
            INSERT INTO proposal_regressions (
              proposal_id, project_id, chunk_id, caused_by
            )
            SELECT ${proposalId}, ${job.project_id}, ${job.chunk_id}, created_by
            FROM type_proposals
            WHERE id = ${proposalId}
            ON CONFLICT (proposal_id, chunk_id) DO NOTHING
            RETURNING caused_by
          `
          yield* activity.record({
            projectId: job.project_id,
            actorId: regressions[0]?.caused_by ?? null,
            kind: "became_stale",
            chunkId: job.chunk_id,
            subjectId: proposalId,
            summary: `${job.entry_symbol} went stale during type revalidation`
          })
          yield* sql`
            UPDATE type_proposals
            SET revalidation_failed = revalidation_failed + 1
            WHERE id = ${proposalId}
          `
        }

        yield* finalizeProposalIfDone(proposalId)
      }))
      return true
    }

    // Interactive path. One transaction, and only for the attempt the chunk is
    // still validating (audit A-001, I4). The chunk row is locked before the
    // match row is written, so a stale result cannot leave an orphan match.
    yield* sql.withTransaction(Effect.gen(function*() {
      const finished = yield* finishJob(job.id, "succeeded", matchResult)
      if (!finished) return

      yield* sql`
        UPDATE attempts
        SET
          score = ${matchResult.score},
          matched = ${matchResult.matched},
          original_insns = ${matchResult.originalInsns},
          equal_insns = ${matchResult.equalInsns},
          compiler_ok = ${matchResult.compilerOk},
          diagnostics = ${matchResult.diagnostics},
          toolchain_digest = ${matchResult.toolchainDigest},
          finished_at = now()
        WHERE id = ${attempt.id}
      `

      const current = yield* sql<{ readonly id: string }>`
        SELECT id
        FROM chunks
        WHERE id = ${job.chunk_id}
          AND state = 'validating'
          AND lease_token = ${attempt.lease_token}
        FOR UPDATE
      `
      if (current[0] === undefined) {
        // The lease ended or moved on while this job ran. The attempt keeps
        // its score, and the chunk is left as it is.
        return
      }

      if (matchResult.matched) {
        yield* sql`
          INSERT INTO blobs (sha256, size_bytes, content_type)
          VALUES (
            ${canonicalBytes},
            ${canonicalBytes.byteLength},
            ${"application/octet-stream"}
          )
          ON CONFLICT DO NOTHING
        `
        const matchRows = yield* sql<{ readonly id: string }>`
          INSERT INTO matches (
            chunk_id, attempt_id, user_id, type_revision_id,
            toolchain_digest, canonical_sha256, language
          ) VALUES (
            ${job.chunk_id},
            ${attempt.id},
            ${attempt.user_id},
            ${attempt.type_revision_id},
            ${matchResult.toolchainDigest},
            ${canonicalBytes},
            ${attempt.language}
          )
          RETURNING id
        `

        const matchId = matchRows[0]?.id ?? null
        yield* activity.releaseSideLeases(job.chunk_id)
        yield* sql`
          UPDATE chunks
          SET
            state = 'matched',
            current_match_id = ${matchId},
            best_attempt_id = ${attempt.id},
            lease_user_id = NULL,
            lease_token = NULL,
            lease_expires_at = NULL,
            hold_started_at = NULL,
            updated_at = now()
          WHERE id = ${job.chunk_id}
            AND state = 'validating'
            AND lease_token = ${attempt.lease_token}
        `
        yield* activity.record({
          projectId: job.project_id,
          actorId: attempt.user_id,
          kind: "matched",
          chunkId: job.chunk_id,
          summary: `Matched ${job.entry_symbol}`
        })
      } else {
        // A miss hands the lease back with a fresh lease_hours window, never
        // past max_hold_hours and never shorter than before (audit A-023).
        // Otherwise a long queue wait could leave the holder minutes from expiry.
        yield* sql`
          UPDATE chunks AS c
          SET
            state = 'leased',
            best_attempt_id = ${attempt.id},
            lease_expires_at = GREATEST(
              c.lease_expires_at,
              LEAST(
                now() + make_interval(hours => p.lease_hours),
                c.hold_started_at + make_interval(hours => p.max_hold_hours)
              )
            ),
            updated_at = now()
          FROM projects p
          WHERE c.id = ${job.chunk_id}
            AND c.project_id = p.id
            AND c.state = 'validating'
            AND c.lease_token = ${attempt.lease_token}
        `
        yield* activity.record({
          projectId: job.project_id,
          actorId: attempt.user_id,
          kind: "match_missed",
          chunkId: job.chunk_id,
          summary: `Missed ${job.entry_symbol}`
        })
      }

      yield* stats.refresh(job.project_id)
    }))
    return true
  })

  const processOnce = (index: number) => Effect.gen(function*() {
    const claimed = yield* sql<JobRow>`
      UPDATE jobs
      SET
        state = 'claimed',
        claimed_by = ${`api-match-${index}`},
        claim_expires_at = now() + interval '2 minutes'
      WHERE id = (
        SELECT id FROM jobs
        WHERE state = 'queued'
           OR (state = 'claimed' AND claim_expires_at < now())
        ORDER BY priority ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING
        id,
        attempt_id,
        proposal_id,
        chunk_id,
        project_id,
        kind,
        entry_symbol,
        language,
        toolchain,
        original_sha256
    `

    const job = claimed[0]
    if (job === undefined) {
      // One worker drains recipe rechecks, and only when no submit is waiting.
      if (index !== 0) return false
      return yield* processRecipe
    }

    // A job that throws is ended, not left `claimed`. Otherwise its claim
    // expires and the same failure repeats every 2 minutes (audit A-001).
    return yield* runJob(job).pipe(
      Effect.catchCauseIf(
        (cause) => !Cause.hasInterrupts(cause),
        (cause) =>
          Effect.logWarning(`match job ${job.id} failed`, cause).pipe(
            Effect.andThen(failJob(job, `internal error: ${Cause.pretty(cause).slice(0, 2000)}`)),
            Effect.as(true)
          )
      )
    )
  }).pipe(Effect.orDie)

  const configuredWorkers = yield* Config.Int("MATCHD_WORKERS").pipe(
    Config.withDefault(4)
  )
  const workerCount = Math.min(32, Math.max(1, configuredWorkers))

  const runWorker = (index: number) =>
    Effect.gen(function*() {
      const worked = yield* processOnce(index).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`match worker ${index} tick failed`, cause).pipe(
            Effect.as(false)
          )
        )
      )
      if (!worked) {
        yield* Effect.sleep("2 seconds")
      }
    }).pipe(Effect.forever, Effect.forkScoped)

  yield* Effect.logInfo(`match workers started (${workerCount})`)
  for (let index = 0; index < workerCount; index++) {
    yield* runWorker(index)
  }
}))
