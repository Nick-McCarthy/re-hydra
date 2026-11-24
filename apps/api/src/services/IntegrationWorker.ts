import { Effect, Layer, Option } from "effect"
import { SqlClient } from "effect/sql"
import type { SourceLanguage, Toolchain } from "../domain/Project.js"
import { Activity } from "./Activity.js"
import { Blobs } from "./Blobs.js"
import { MatchdClient } from "./MatchdClient.js"
import { ProjectChunkStats } from "./ProjectChunkStats.js"
import { compilerPin, isPinnedDigest } from "./ToolchainPin.js"

type ClaimedIntegration = {
  readonly id: string
  readonly project_id: string
  readonly binary_id: string
  readonly language: string
  readonly toolchain: Toolchain
  readonly arch: string
  readonly headers_sha256: Uint8Array | null
}

type UnitSource = {
  readonly chunk_id: string
  readonly name: string
  readonly address: string | number | bigint
  readonly size: number
  readonly bytes_sha256: Uint8Array
  readonly source_sha256: Uint8Array | null
  readonly toolchain_digest: string | null
  readonly allow_inline_asm: boolean
}

const asLanguage = (value: string): SourceLanguage => (value === "cpp" ? "cpp" : "c")

/**
 * Claims a queued integration build, links the matched sources at their
 * original addresses, and reopens chunks whose linked bytes disagree.
 */
export const IntegrationWorkerLive = Layer.effectDiscard(Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const blobs = yield* Blobs
  const matchd = yield* MatchdClient
  const stats = yield* ProjectChunkStats
  const activity = yield* Activity

  const reopen = Effect.fn("IntegrationWorker.reopen")(function*(
    projectId: string,
    integrationId: string,
    chunkId: string,
    name: string,
    detail: string
  ) {
    yield* sql`
      UPDATE matches
      SET
        invalidated_at = now(),
        invalidated_reason = ${"integration build"}
      WHERE chunk_id = ${chunkId}
        AND invalidated_at IS NULL
    `
    const updated = yield* sql<{ readonly id: string }>`
      UPDATE chunks
      SET
        state = 'stale',
        current_match_id = NULL,
        lease_user_id = NULL,
        lease_token = NULL,
        lease_expires_at = NULL,
        hold_started_at = NULL,
        updated_at = now()
      WHERE id = ${chunkId}
        AND state = 'matched'
      RETURNING id
    `
    if (updated[0] === undefined) return
    const firstLine = detail.split("\n")[0] ?? "linked bytes differ"
    yield* activity.record({
      projectId,
      actorId: null,
      kind: "integration_reopened",
      chunkId,
      subjectId: integrationId,
      summary: `Reopened ${name}: ${firstLine}`
    })
  })

  const processOnce = Effect.gen(function*() {
    const claimed = yield* sql<{
      readonly id: string
      readonly project_id: string
      readonly binary_id: string
      readonly language: string
      readonly toolchain: Toolchain
    }>`
      UPDATE integrations
      SET status = 'running', claimed_at = now()
      WHERE id = (
        SELECT id FROM integrations
        WHERE status = 'queued'
           OR (status = 'running' AND claimed_at < now() - interval '2 minutes')
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, project_id, binary_id, language, toolchain
    `

    const claimedRow = claimed[0]
    if (claimedRow === undefined) return

    const contextRows = yield* sql<{
      readonly arch: string
      readonly headers_sha256: Uint8Array | null
    }>`
      SELECT
        b.arch,
        (
          SELECT tr.headers_sha256
          FROM type_revisions tr
          WHERE tr.project_id = ${claimedRow.project_id}
          ORDER BY tr.revision DESC
          LIMIT 1
        ) AS headers_sha256
      FROM binaries b
      WHERE b.id = ${claimedRow.binary_id}
      LIMIT 1
    `
    const context = contextRows[0]
    if (context === undefined) return

    const job: ClaimedIntegration = {
      ...claimedRow,
      arch: context.arch,
      headers_sha256: context.headers_sha256
    }

    const finish = (
      status: "passed" | "failed" | "error",
      summary: string,
      diagnostics: string,
      digest: string | null
    ) =>
      sql`
        UPDATE integrations
        SET
          status = ${status},
          summary = ${summary},
          diagnostics = ${diagnostics},
          toolchain_digest = ${digest},
          finished_at = now()
        WHERE id = ${job.id}
      `

    const units = yield* sql<UnitSource>`
      SELECT
        u.chunk_id,
        u.name,
        u.address,
        u.size,
        c.bytes_sha256,
        a.source_sha256,
        m.toolchain_digest,
        c.allow_inline_asm
      FROM integration_units u
      INNER JOIN chunks c ON c.id = u.chunk_id
      LEFT JOIN attempts a ON a.id = c.best_attempt_id
      LEFT JOIN matches m ON m.id = c.current_match_id
      WHERE u.integration_id = ${job.id}
      ORDER BY u.address
    `

    let headers = "/* empty */\n"
    if (job.headers_sha256 !== null) {
      const headersOpt = yield* blobs.get(job.headers_sha256)
      if (Option.isSome(headersOpt)) {
        headers = Buffer.from(headersOpt.value).toString("utf8")
      }
    }

    const linkUnits: Array<{
      symbol: string
      address: string
      size: number
      originalBytesBase64: string
      source: string
      chunkId: string
      allowInlineAsm: boolean
    }> = []
    const localFailures: Array<{ chunkId: string; name: string; detail: string }> = []

    for (const unit of units) {
      if (unit.source_sha256 === null) {
        localFailures.push({
          chunkId: unit.chunk_id,
          name: unit.name,
          detail: "matched source is missing"
        })
        continue
      }
      const sourceOpt = yield* blobs.get(unit.source_sha256)
      const bytesOpt = yield* blobs.get(unit.bytes_sha256)
      if (Option.isNone(sourceOpt) || Option.isNone(bytesOpt)) {
        localFailures.push({
          chunkId: unit.chunk_id,
          name: unit.name,
          detail: "matched source is missing"
        })
        continue
      }
      linkUnits.push({
        symbol: unit.name,
        address: String(unit.address),
        size: unit.size,
        originalBytesBase64: Buffer.from(bytesOpt.value).toString("base64"),
        source: Buffer.from(sourceOpt.value).toString("utf8"),
        chunkId: unit.chunk_id,
        allowInlineAsm: unit.allow_inline_asm
      })
    }

    if (linkUnits.length === 0) {
      yield* finish("error", "Integration build had no source to link", "matched source is missing", null)
      yield* activity.record({
        projectId: job.project_id,
        kind: "integration_failed",
        subjectId: job.id,
        summary: "Integration build failed: matched source is missing"
      })
      return
    }

    const pins = new Set<string>()
    let expectedDigest: string | undefined
    for (const unit of units) {
      if (!isPinnedDigest(unit.toolchain_digest)) continue
      const pin = compilerPin(unit.toolchain_digest)
      if (pin === undefined) continue
      pins.add(pin)
      if (expectedDigest === undefined) expectedDigest = unit.toolchain_digest
    }
    if (pins.size > 1) {
      const diagnostics = "matches were proved with different compilers"
      yield* finish("error", "Integration build stopped", diagnostics, null)
      yield* activity.record({
        projectId: job.project_id,
        kind: "integration_failed",
        subjectId: job.id,
        summary: "Integration build stopped: matches were proved with different compilers"
      })
      return
    }

    const result = yield* matchd.runLink({
      jobId: job.id,
      arch: job.arch,
      language: asLanguage(job.language),
      toolchain: job.toolchain,
      flags: job.toolchain.flags,
      ...(expectedDigest !== undefined ? { expectedToolchainDigest: expectedDigest } : {}),
      headers,
      units: linkUnits.map((unit) => ({
        symbol: unit.symbol,
        address: unit.address,
        size: unit.size,
        originalBytesBase64: unit.originalBytesBase64,
        source: unit.source,
        // Audit A-032: the same inline-assembly rule as the checkout match.
        allowInlineAsm: unit.allowInlineAsm
      }))
    }).pipe(
      Effect.catch((err) =>
        Effect.succeed({
          jobId: job.id,
          compilerOk: false,
          diagnostics: `matchd error: ${String(err)}`,
          toolchainDigest: "unavailable",
          units: [] as Array<{ symbol: string; passed: boolean; detail: string }>
        })
      )
    )

    const bySymbol = new Map(result.units.map((unit) => [unit.symbol, unit]))
    const reopened: Array<string> = []

    yield* sql.withTransaction(Effect.gen(function*() {
      for (const failure of localFailures) {
        yield* sql`
          UPDATE integration_units
          SET passed = false, detail = ${failure.detail}
          WHERE integration_id = ${job.id} AND chunk_id = ${failure.chunkId}
        `
      }

      for (const unit of linkUnits) {
        const outcome = bySymbol.get(unit.symbol)
        const passed = result.compilerOk && outcome?.passed === true
        const detail = outcome?.detail ?? result.diagnostics
        yield* sql`
          UPDATE integration_units
          SET passed = ${passed}, detail = ${detail}
          WHERE integration_id = ${job.id} AND chunk_id = ${unit.chunkId}
        `
        if (result.compilerOk && !passed) {
          yield* reopen(job.project_id, job.id, unit.chunkId, unit.symbol, detail)
          reopened.push(unit.symbol)
        }
      }

      for (const failure of localFailures) {
        if (result.compilerOk) {
          yield* reopen(
            job.project_id,
            job.id,
            failure.chunkId,
            failure.name,
            failure.detail
          )
          reopened.push(failure.name)
        }
      }

      if (reopened.length > 0) {
        yield* stats.refresh(job.project_id)
      }

      if (!result.compilerOk) {
        yield* finish(
          "error",
          "Integration build did not link",
          result.diagnostics,
          result.toolchainDigest
        )
        yield* activity.record({
          projectId: job.project_id,
          kind: "integration_failed",
          subjectId: job.id,
          summary: "Integration build failed to compile or link"
        })
        return
      }

      if (reopened.length === 0) {
        yield* finish(
          "passed",
          result.diagnostics,
          result.diagnostics,
          result.toolchainDigest
        )
        yield* activity.record({
          projectId: job.project_id,
          kind: "integration_passed",
          subjectId: job.id,
          summary: result.diagnostics
        })
        return
      }

      const summary = `Reopened ${reopened.join(", ")}`
      yield* finish("failed", summary, result.diagnostics, result.toolchainDigest)
      yield* activity.record({
        projectId: job.project_id,
        kind: "integration_failed",
        subjectId: job.id,
        summary
      })
    }))
  }).pipe(Effect.orDie)

  yield* Effect.logInfo("integration worker started")
  yield* processOnce.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("integration worker tick failed", cause)
    ),
    Effect.andThen(Effect.sleep("2 seconds")),
    Effect.forever,
    Effect.forkScoped
  )
}))
