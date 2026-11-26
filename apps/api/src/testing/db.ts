/**
 * Harness for tests that run against Postgres (roadmap, Next step 3).
 *
 * Each `dbTest` body runs in one transaction that is always rolled back, so
 * tests leave nothing behind and cannot see each other's rows. `npm run
 * verify` runs these files against its freshly migrated database; by hand,
 * set TEST_DATABASE_URL to a migrated database and run `npm run test:db -w
 * @re-hydra/api`.
 *
 * Inside one transaction `now()` does not move, so fixtures place timestamps
 * relative to it (`"-1 hour"`, `"30 minutes"`) instead of waiting.
 *
 * Fixtures only insert rows. Changes to chunk state go through ChunkState,
 * as everywhere else (chunkStateWrites.test.ts).
 */
import { randomBytes, randomUUID } from "node:crypto"
import { after, test } from "node:test"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { SqlLiveFromUrl } from "../db/SqlLive.js"
import { ChunkState } from "../services/ChunkState.js"
import { ProjectChunkStats } from "../services/ProjectChunkStats.js"

const url = process.env.TEST_DATABASE_URL
if (url === undefined || url === "") {
  throw new Error(
    "TEST_DATABASE_URL is not set. Run these through `npm run verify -- --only chunk-state`, " +
      "or point TEST_DATABASE_URL at a migrated database you do not mind writing to (every test rolls back)."
  )
}

const TestLive = ChunkState.layer.pipe(
  Layer.provideMerge(ProjectChunkStats.layer),
  Layer.provideMerge(SqlLiveFromUrl(url))
)
type Services = Layer.Success<typeof TestLive>

const runtime = ManagedRuntime.make(TestLive)
after(() => runtime.dispose())

class Rollback extends Schema.TaggedError<Rollback>()("Rollback", {}) {}

/** A test whose database work is rolled back when it ends, pass or fail. */
export const dbTest = (name: string, body: Effect.Effect<void, never, Services>) =>
  test(name, () =>
    runtime.runPromise(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient
        yield* sql.withTransaction(Effect.andThen(body, Effect.fail(new Rollback()))).pipe(
          Effect.catchTag("Rollback", () => Effect.void),
          Effect.orDie
        )
      })
    ))

/** An interval relative to the transaction's `now()`, such as "-1 hour". */
export type Offset = string

const sha = () => randomBytes(32)
let counter = 0
const next = () => ++counter

const blob = Effect.fnUntraced(function*() {
  const sql = yield* SqlClient.SqlClient
  const digest = sha()
  yield* sql`
    INSERT INTO blobs (sha256, size_bytes, content_type)
    VALUES (${digest}, ${1}, ${"application/octet-stream"})
  `
  return digest
}, Effect.orDie)

export const makeUser = Effect.fnUntraced(function*() {
  const sql = yield* SqlClient.SqlClient
  const n = next()
  const rows = yield* sql<{ readonly id: string }>`
    INSERT INTO users (email, display_name)
    VALUES (${`chunk-state-${n}-${randomUUID()}@example.test`}, ${`Tester ${n} ${randomUUID().slice(0, 8)}`})
    RETURNING id
  `
  return rows[0]!.id
}, Effect.orDie)

export interface TestProject {
  readonly id: string
  readonly slug: string
  readonly binaryId: string
  readonly typeRevisionId: string
  readonly blob: Uint8Array
}

export interface ProjectOptions {
  readonly leaseHours?: number
  readonly maxHoldHours?: number
  readonly maxConcurrentLeases?: number
  readonly maxHeldChunks?: number
}

// Each fixture with optional settings is a traced function taking them
// required, behind a plain function that fills in `{}` (a defaulted parameter
// drops out of Effect.fnUntraced's type when it is given a pipe).
const makeProjectWith = Effect.fnUntraced(function*(options: ProjectOptions) {
  const sql = yield* SqlClient.SqlClient
  const digest = yield* blob()
  const slug = `chunk-state-${next()}-${randomUUID().slice(0, 8)}`
  const projects = yield* sql<{ readonly id: string }>`
    INSERT INTO projects (
      slug, name, home_region, language, toolchain,
      lease_hours, max_hold_hours, max_concurrent_leases, max_held_chunks
    ) VALUES (
      ${slug}, ${slug}, ${"us-east-1"}, ${"c"}, ${JSON.stringify({ id: "test" })}::jsonb,
      ${options.leaseHours ?? 24}, ${options.maxHoldHours ?? 48},
      ${options.maxConcurrentLeases ?? 1}, ${options.maxHeldChunks ?? 8}
    )
    RETURNING id
  `
  const id = projects[0]!.id
  const binaries = yield* sql<{ readonly id: string }>`
    INSERT INTO binaries (project_id, sha256, arch, name)
    VALUES (${id}, ${digest}, ${"x86_64"}, ${"test.bin"})
    RETURNING id
  `
  const revisions = yield* sql<{ readonly id: string }>`
    INSERT INTO type_revisions (project_id, headers_sha256, revision)
    VALUES (${id}, ${digest}, ${1})
    RETURNING id
  `
  return { id, slug, binaryId: binaries[0]!.id, typeRevisionId: revisions[0]!.id, blob: digest } satisfies TestProject
}, Effect.orDie)

/** An `open` chunk, or one already `leased` to `leasedTo`, counted on the board. */
export interface ChunkOptions {
  readonly name?: string
  readonly leasedTo?: string
  readonly expiresIn?: Offset
  readonly heldFor?: Offset
}

const makeChunkWith = Effect.fnUntraced(function*(project: TestProject, options: ChunkOptions) {
  const sql = yield* SqlClient.SqlClient
  const n = next()
  const leased = options.leasedTo !== undefined
  const token = leased ? randomUUID() : null
  const rows = yield* sql<{ readonly id: string }>`
    INSERT INTO chunks (
      project_id, binary_id, name, address, size,
      bytes_sha256, pseudocode_sha256, disassembly_sha256, type_revision_id,
      state, lease_user_id, lease_token, lease_expires_at, hold_started_at
    ) VALUES (
      ${project.id}, ${project.binaryId}, ${options.name ?? `fn_${n}`}, ${0x1000 + n * 16}, ${16},
      ${project.blob}, ${project.blob}, ${project.blob}, ${project.typeRevisionId},
      ${leased ? "leased" : "open"}::chunk_state,
      ${options.leasedTo ?? null},
      ${token}::uuid,
      CASE WHEN ${leased} THEN now() + ${options.expiresIn ?? "24 hours"}::interval END,
      CASE WHEN ${leased} THEN now() - ${options.heldFor ?? "0 seconds"}::interval END
    )
    RETURNING id
  `
  // As an import does: the board counts the new chunk.
  yield* (yield* ProjectChunkStats).refresh(project.id)
  return { id: rows[0]!.id, leaseToken: token }
}, Effect.orDie)

/** An attempt and its match on a chunk, not yet the chunk's current match. */
export interface MatchOptions {
  readonly usesInlineAsm?: boolean
}

const makeMatchWith = Effect.fnUntraced(function*(
  project: TestProject,
  chunkId: string,
  userId: string,
  leaseToken: string,
  options: MatchOptions
) {
  const sql = yield* SqlClient.SqlClient
  const attempts = yield* sql<{ readonly id: string }>`
    INSERT INTO attempts (chunk_id, user_id, lease_token, source_sha256, type_revision_id, language)
    VALUES (${chunkId}, ${userId}, ${leaseToken}, ${project.blob}, ${project.typeRevisionId}, ${"c"})
    RETURNING id
  `
  const attemptId = attempts[0]!.id
  const matches = yield* sql<{ readonly id: string }>`
    INSERT INTO matches (
      chunk_id, attempt_id, user_id, type_revision_id, toolchain_digest, canonical_sha256, language, uses_inline_asm
    ) VALUES (
      ${chunkId}, ${attemptId}, ${userId}, ${project.typeRevisionId}, ${"digest"}, ${project.blob}, ${"c"},
      ${options.usesInlineAsm ?? false}
    )
    RETURNING id
  `
  return { attemptId, matchId: matches[0]!.id }
}, Effect.orDie)

const makeJobWith = Effect.fnUntraced(function*(
  project: TestProject,
  chunkId: string,
  attemptId: string,
  state: "queued" | "claimed" | "succeeded"
) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ readonly id: string }>`
    INSERT INTO jobs (
      project_id, chunk_id, attempt_id, kind, state, toolchain, language, entry_symbol, original_sha256, sources
    ) VALUES (
      ${project.id}, ${chunkId}, ${attemptId}, ${"interactive"}, ${state}::job_state,
      ${JSON.stringify({ id: "test" })}::jsonb, ${"c"}, ${"fn"}, ${project.blob}, ${"[]"}::jsonb
    )
    RETURNING id
  `
  return rows[0]!.id
}, Effect.orDie)

/**
 * Walk a chunk through a real checkout, submit, and match, so it is `matched`
 * with a current match. Returns the match.
 */
const makeMatchedChunkWith = Effect.fnUntraced(function*(project: TestProject, userId: string, options: MatchOptions) {
  const chunkState = yield* ChunkState
  const chunk = yield* makeChunk(project)
  const leaseToken = randomUUID()
  yield* chunkState.claim({ chunkId: chunk.id, projectId: project.id, userId, leaseToken, leaseHours: 24 })
  yield* chunkState.startValidating({ chunkId: chunk.id, userId, leaseToken, primary: true })
  const { attemptId, matchId } = yield* makeMatch(project, chunk.id, userId, leaseToken, options)
  yield* chunkState.recordMatch({ chunkId: chunk.id, projectId: project.id, leaseToken, matchId, attemptId })
  return { id: chunk.id, attemptId, matchId }
})

export interface ChunkRow {
  readonly state: string
  readonly lease_user_id: string | null
  readonly lease_token: string | null
  readonly lease_expires_at: Date | null
  readonly hold_started_at: Date | null
  readonly current_match_id: string | null
  readonly best_attempt_id: string | null
  readonly fuse_parent_id: string | null
}

export const chunkRow = Effect.fnUntraced(function*(chunkId: string) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<ChunkRow>`
    SELECT state, lease_user_id, lease_token, lease_expires_at, hold_started_at,
           current_match_id, best_attempt_id, fuse_parent_id
    FROM chunks WHERE id = ${chunkId}
  `
  return rows[0]!
}, Effect.orDie)

/** The transaction's `now()` plus an offset, as a Date. */
export const at = Effect.fnUntraced(function*(offset: Offset) {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ readonly t: Date }>`SELECT now() + ${offset}::interval AS t`
  return rows[0]!.t
}, Effect.orDie)

/** The stored board counts, and a fresh count from `chunks`. */
export const boardCounts = Effect.fnUntraced(function*(projectId: string) {
  const sql = yield* SqlClient.SqlClient
  const stored = yield* sql<Record<string, number>>`
    SELECT open_count, leased_count, validating_count, matched_count, stale_count, blocked_count, total_count
    FROM project_chunk_stats WHERE project_id = ${projectId}
  `
  const actual = yield* sql<Record<string, number>>`
    SELECT
      COUNT(*) FILTER (WHERE state = 'open')::int AS open_count,
      COUNT(*) FILTER (WHERE state = 'leased')::int AS leased_count,
      COUNT(*) FILTER (WHERE state = 'validating')::int AS validating_count,
      COUNT(*) FILTER (WHERE state = 'matched')::int AS matched_count,
      COUNT(*) FILTER (WHERE state = 'stale')::int AS stale_count,
      COUNT(*) FILTER (WHERE state = 'blocked')::int AS blocked_count,
      COUNT(*)::int AS total_count
    FROM chunks WHERE project_id = ${projectId} AND fuse_parent_id IS NULL
  `
  return { stored: stored[0], actual: actual[0]! }
}, Effect.orDie)

/** Active competing leases on a chunk, oldest first. */
export const competingLeases = Effect.fnUntraced(function*(chunkId: string) {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<{ readonly user_id: string; readonly lease_token: string; readonly lease_expires_at: Date }>`
    SELECT user_id, lease_token, lease_expires_at FROM chunk_leases
    WHERE chunk_id = ${chunkId} AND released_at IS NULL
    ORDER BY created_at, id
  `
}, Effect.orDie)

export const makeProject = (options: ProjectOptions = {}) => makeProjectWith(options)
export const makeChunk = (project: TestProject, options: ChunkOptions = {}) => makeChunkWith(project, options)
export const makeMatch = (
  project: TestProject,
  chunkId: string,
  userId: string,
  leaseToken: string,
  options: MatchOptions = {}
) => makeMatchWith(project, chunkId, userId, leaseToken, options)
export const makeMatchedChunk = (project: TestProject, userId: string, options: MatchOptions = {}) =>
  makeMatchedChunkWith(project, userId, options)
/** An interactive job for an attempt, `queued` unless said otherwise. */
export const makeJob = (
  project: TestProject,
  chunkId: string,
  attemptId: string,
  state: "queued" | "claimed" | "succeeded" = "queued"
) => makeJobWith(project, chunkId, attemptId, state)
