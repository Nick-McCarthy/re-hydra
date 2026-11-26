import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import {
  at,
  boardCounts,
  chunkRow,
  competingLeases,
  dbTest,
  makeChunk,
  makeJob,
  makeMatch,
  makeMatchedChunk,
  makeProject,
  makeUser,
  type TestProject
} from "../testing/db.js"
import { ChunkState } from "./ChunkState.js"

// Submissions and results: validating, match, miss, a job with no result,
// and going stale (roadmap, Next step 3). Each test rolls back.

const assertBoard = Effect.fnUntraced(function*(project: TestProject) {
  const { stored, actual } = yield* boardCounts(project.id)
  assert.deepEqual(stored, actual, "project_chunk_stats matches a fresh count")
})

/** A chunk leased to `userId` and submitted, with its attempt and queued job. */
const submitted = Effect.fnUntraced(function*(project: TestProject, userId: string, lease: {
  readonly expiresIn?: string
  readonly heldFor?: string
} = {}) {
  const chunkState = yield* ChunkState
  const chunk = yield* makeChunk(project, { leasedTo: userId, ...lease })
  const leaseToken = chunk.leaseToken!
  const moved = yield* chunkState.startValidating({ chunkId: chunk.id, userId, leaseToken, primary: true })
  assert.equal(moved?.chunk_id, chunk.id)
  const { attemptId, matchId } = yield* makeMatch(project, chunk.id, userId, leaseToken)
  const jobId = yield* makeJob(project, chunk.id, attemptId)
  return { id: chunk.id, leaseToken, attemptId, matchId, jobId }
})

dbTest("submitting moves the holder's live lease to validating and keeps the lease", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject()
  const user = yield* makeUser()
  const chunk = yield* makeChunk(project, { leasedTo: user })
  const before = yield* chunkRow(chunk.id)

  const moved = yield* chunkState.startValidating({ chunkId: chunk.id, userId: user, leaseToken: chunk.leaseToken!, primary: true })
  assert.deepEqual(moved, { chunk_id: chunk.id, project_id: project.id })
  const row = yield* chunkRow(chunk.id)
  assert.equal(row.state, "validating")
  assert.deepEqual(
    [row.lease_user_id, row.lease_token, row.lease_expires_at, row.hold_started_at],
    [before.lease_user_id, before.lease_token, before.lease_expires_at, before.hold_started_at]
  )
  yield* assertBoard(project)

  const again = yield* chunkState.startValidating({ chunkId: chunk.id, userId: user, leaseToken: chunk.leaseToken!, primary: true })
  assert.equal(again, undefined, "audit A-002: one submission in flight")
}))

dbTest("submitting refuses an expired lease or someone else's token", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject()
  const user = yield* makeUser()
  const other = yield* makeUser()
  const expired = yield* makeChunk(project, { leasedTo: user, expiresIn: "-1 minute" })
  const live = yield* makeChunk(project, { leasedTo: user })

  assert.equal(
    yield* chunkState.startValidating({ chunkId: expired.id, userId: user, leaseToken: expired.leaseToken!, primary: true }),
    undefined
  )
  assert.equal(
    yield* chunkState.startValidating({ chunkId: live.id, userId: other, leaseToken: live.leaseToken!, primary: true }),
    undefined
  )
  assert.equal((yield* chunkRow(expired.id)).state, "leased")
  assert.equal((yield* chunkRow(live.id)).state, "leased")
}))

dbTest("a competing holder who submits takes the chunk; the holder waits as a competing lease", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject({ maxConcurrentLeases: 2 })
  const holder = yield* makeUser()
  const challenger = yield* makeUser()
  const chunk = yield* makeChunk(project, { leasedTo: holder })
  const side = yield* chunkState.addCompetingLease({
    chunkId: chunk.id,
    projectId: project.id,
    userId: challenger,
    leaseToken: randomUUID()
  })
  assert.notEqual(side, undefined)

  const moved = yield* chunkState.startValidating({
    chunkId: chunk.id,
    userId: challenger,
    leaseToken: side!.lease_token,
    primary: false
  })
  assert.equal(moved?.chunk_id, chunk.id)
  const row = yield* chunkRow(chunk.id)
  assert.equal(row.state, "validating")
  assert.equal(row.lease_user_id, challenger)
  assert.equal(row.lease_token, side!.lease_token)
  const waiting = yield* competingLeases(chunk.id)
  assert.deepEqual(waiting.map((lease) => [lease.user_id, lease.lease_token]), [[holder, chunk.leaseToken]])
}))

dbTest("a match ends the lease, sets the current match, and ends competing leases", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject({ maxConcurrentLeases: 2 })
  const user = yield* makeUser()
  const chunk = yield* submitted(project, user)
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    INSERT INTO chunk_leases (chunk_id, user_id, lease_token, lease_expires_at, hold_started_at)
    VALUES (${chunk.id}, ${yield* makeUser()}, ${randomUUID()}, now() + interval '1 hour', now())
  `.pipe(Effect.orDie)

  yield* chunkState.recordMatch({
    chunkId: chunk.id,
    projectId: project.id,
    leaseToken: chunk.leaseToken,
    matchId: chunk.matchId,
    attemptId: chunk.attemptId
  })
  const row = yield* chunkRow(chunk.id)
  assert.equal(row.state, "matched")
  assert.equal(row.current_match_id, chunk.matchId)
  assert.equal(row.best_attempt_id, chunk.attemptId)
  assert.deepEqual([row.lease_user_id, row.lease_token, row.lease_expires_at, row.hold_started_at], [null, null, null, null])
  assert.equal((yield* competingLeases(chunk.id)).length, 0)
  yield* assertBoard(project)
}))

dbTest("a result applies once, and only to the lease it was submitted under", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject()
  const user = yield* makeUser()
  const chunk = yield* submitted(project, user)
  const result = {
    chunkId: chunk.id,
    projectId: project.id,
    leaseToken: chunk.leaseToken,
    attemptId: chunk.attemptId
  }

  yield* chunkState.recordMiss({ ...result, leaseToken: randomUUID() })
  assert.equal((yield* chunkRow(chunk.id)).state, "validating", "a result for another lease changes nothing")

  yield* chunkState.recordMatch({ ...result, matchId: chunk.matchId })
  const matched = yield* chunkRow(chunk.id)
  yield* chunkState.recordMiss(result)
  yield* chunkState.recordMatch({ ...result, matchId: null })
  assert.deepEqual(yield* chunkRow(chunk.id), matched, "audit A-001: a second result changes nothing")
}))

dbTest("a miss hands the lease back with a fresh window, never past max_hold_hours", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject({ leaseHours: 10, maxHoldHours: 48 })
  const user = yield* makeUser()
  const nearExpiry = yield* submitted(project, user, { expiresIn: "5 minutes", heldFor: "1 hour" })
  const nearLimit = yield* submitted(project, user, { expiresIn: "5 minutes", heldFor: "45 hours" })
  const longLease = yield* submitted(project, user, { expiresIn: "20 hours", heldFor: "1 hour" })
  const miss = (chunk: { readonly id: string; readonly leaseToken: string; readonly attemptId: string }) =>
    chunkState.recordMiss({ chunkId: chunk.id, projectId: project.id, leaseToken: chunk.leaseToken, attemptId: chunk.attemptId })

  yield* miss(nearExpiry)
  const extended = yield* chunkRow(nearExpiry.id)
  assert.equal(extended.state, "leased")
  assert.equal(extended.best_attempt_id, nearExpiry.attemptId)
  assert.equal(extended.lease_expires_at?.getTime(), (yield* at("10 hours")).getTime(), "audit A-023")

  yield* miss(nearLimit)
  assert.equal((yield* chunkRow(nearLimit.id)).lease_expires_at?.getTime(), (yield* at("3 hours")).getTime())

  yield* miss(longLease)
  assert.equal(
    (yield* chunkRow(longLease.id)).lease_expires_at?.getTime(),
    (yield* at("20 hours")).getTime(),
    "never shorter than before"
  )
  yield* assertBoard(project)
}))

dbTest("a job with no result returns the chunk to its holder", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const sql = yield* SqlClient.SqlClient
  const project = yield* makeProject()
  const user = yield* makeUser()
  const chunk = yield* submitted(project, user)
  const noToken = yield* submitted(project, user)
  const back = (target: { readonly id: string; readonly jobId: string }, leaseToken: string | null) =>
    chunkState.returnFromValidating({ chunkId: target.id, projectId: project.id, jobId: target.jobId, leaseToken })
  const before = yield* chunkRow(chunk.id)

  // Audit A-004: a second job in flight would keep the chunk validating. The
  // database refuses one outright (jobs_one_active_interactive); the check in
  // returnFromValidating is the second line. A savepoint keeps this
  // transaction usable after the refusal.
  const second = yield* sql.withTransaction(makeJob(project, chunk.id, chunk.attemptId, "claimed")).pipe(
    Effect.orDie,
    Effect.as("inserted"),
    Effect.catchDefect((defect) => Effect.succeed(String((defect as { cause?: unknown }).cause ?? defect)))
  )
  // Job ids are random, so the only unique rule this insert can break is that index.
  assert.match(second, /UniqueViolation/)

  assert.equal(yield* back(chunk, randomUUID()), false, "a job for another lease")
  assert.equal((yield* chunkRow(chunk.id)).state, "validating")
  assert.ok(yield* back(chunk, chunk.leaseToken))
  const row = yield* chunkRow(chunk.id)
  assert.equal(row.state, "leased")
  assert.equal(row.lease_token, before.lease_token)
  assert.equal(row.lease_expires_at?.getTime(), before.lease_expires_at?.getTime(), "the lease keeps its expiry")
  assert.equal(yield* back(chunk, chunk.leaseToken), false, "once")

  assert.ok(yield* back(noToken, null), "a job whose attempt has no token still returns it")
  assert.equal((yield* chunkRow(noToken.id)).state, "leased")
  yield* assertBoard(project)
}))

dbTest("the sweeper returns validating chunks with no job after five minutes", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const sql = yield* SqlClient.SqlClient
  const project = yield* makeProject()
  const user = yield* makeUser()
  const orphan = yield* submitted(project, user)
  const recent = yield* submitted(project, user)
  const busy = yield* submitted(project, user)
  yield* sql`UPDATE jobs SET state = 'failed' WHERE id IN (${orphan.jobId}, ${recent.jobId})`.pipe(Effect.orDie)
  yield* sql`
    UPDATE chunks SET updated_at = now() - interval '6 minutes' WHERE id IN (${orphan.id}, ${busy.id})
  `.pipe(Effect.orDie)

  const returned = (yield* chunkState.returnOrphanedValidating).filter((row) => row.project_id === project.id)
  assert.deepEqual(returned.map((row) => row.id), [orphan.id])
  assert.equal((yield* chunkRow(orphan.id)).state, "leased")
  assert.equal((yield* chunkRow(recent.id)).state, "validating", "too recent")
  assert.equal((yield* chunkRow(busy.id)).state, "validating", "its job is still queued")
  yield* assertBoard(project)
}))

dbTest("going stale invalidates the active match and empties the chunk", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const sql = yield* SqlClient.SqlClient
  const project = yield* makeProject()
  const user = yield* makeUser()
  const matched = yield* makeMatchedChunk(project, user)

  assert.ok(yield* chunkState.goStale({ chunkId: matched.id, projectId: project.id, reason: "type proposal revalidation failed" }))
  const row = yield* chunkRow(matched.id)
  assert.equal(row.state, "stale")
  assert.equal(row.current_match_id, null)
  const match = yield* sql<{ readonly invalidated_reason: string | null }>`
    SELECT invalidated_reason FROM matches WHERE id = ${matched.matchId}
  `.pipe(Effect.orDie)
  assert.equal(match[0]!.invalidated_reason, "type proposal revalidation failed")
  assert.equal(
    yield* chunkState.goStale({ chunkId: matched.id, projectId: project.id, reason: "again" }),
    false,
    "only a matched chunk goes stale"
  )
  yield* assertBoard(project)
}))

dbTest("inline assembly off makes stale only a match that used it", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject()
  const user = yield* makeUser()
  const plain = yield* makeMatchedChunk(project, user)
  const asm = yield* makeMatchedChunk(project, user, { usesInlineAsm: true })
  const off = (chunkId: string) =>
    chunkState.goStale({ chunkId, projectId: project.id, reason: "inline assembly disallowed", onlyInlineAsm: true })

  assert.equal(yield* off(plain.id), false)
  assert.equal((yield* chunkRow(plain.id)).state, "matched")
  assert.ok(yield* off(asm.id))
  assert.equal((yield* chunkRow(asm.id)).state, "stale")
}))

dbTest("an integration build reopens many chunks with one call", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject()
  const user = yield* makeUser()
  const first = yield* makeMatchedChunk(project, user)
  const second = yield* makeMatchedChunk(project, user)
  const open = yield* makeChunk(project)

  const stale = yield* chunkState.goStaleMany({
    projectId: project.id,
    chunkIds: [first.id, second.id, open.id, first.id],
    reason: "integration build"
  })
  assert.deepEqual([...stale].sort(), [first.id, second.id].sort(), "only matched chunks, each once")
  assert.equal((yield* chunkRow(open.id)).state, "open")
  assert.deepEqual(yield* chunkState.goStaleMany({ projectId: project.id, chunkIds: [], reason: "none" }), [])
  yield* assertBoard(project)
}))
