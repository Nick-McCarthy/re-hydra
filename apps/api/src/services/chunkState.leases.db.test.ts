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
  makeMatchedChunk,
  makeProject,
  makeUser,
  type TestProject
} from "../testing/db.js"
import { ChunkState } from "./ChunkState.js"

// Leases: checkout, competing leases, heartbeats, release, expiry, and the
// pool (roadmap, Next step 3). Each test rolls back.

/** A competing lease written directly, so tests can order and expire them. */
const addSide = Effect.fnUntraced(function*(chunkId: string, userId: string, options: {
  readonly createdAgo: string
  readonly expiresIn?: string
}) {
  const sql = yield* SqlClient.SqlClient
  const token = randomUUID()
  yield* sql`
    INSERT INTO chunk_leases (chunk_id, user_id, lease_token, lease_expires_at, hold_started_at, created_at)
    VALUES (
      ${chunkId}, ${userId}, ${token},
      now() + ${options.expiresIn ?? "12 hours"}::interval,
      now() - ${options.createdAgo}::interval,
      now() - ${options.createdAgo}::interval
    )
  `
  return token
}, Effect.orDie)

const assertBoard = Effect.fnUntraced(function*(project: TestProject) {
  const { stored, actual } = yield* boardCounts(project.id)
  assert.deepEqual(stored, actual, "project_chunk_stats matches a fresh count")
})

dbTest("claim leases an open chunk with every lease column set", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject({ leaseHours: 6 })
  const user = yield* makeUser()
  const chunk = yield* makeChunk(project)
  const leaseToken = randomUUID()

  const claimed = yield* chunkState.claim({ chunkId: chunk.id, projectId: project.id, userId: user, leaseToken, leaseHours: 6 })
  assert.equal(claimed?.id, chunk.id)

  const row = yield* chunkRow(chunk.id)
  assert.equal(row.state, "leased")
  assert.equal(row.lease_user_id, user)
  assert.equal(row.lease_token, leaseToken)
  assert.equal(row.lease_expires_at?.getTime(), (yield* at("6 hours")).getTime())
  assert.equal(row.hold_started_at?.getTime(), (yield* at("0 seconds")).getTime())
  yield* assertBoard(project)
}))

dbTest("claim refuses a chunk that is leased, matched, or fused", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject()
  const holder = yield* makeUser()
  const other = yield* makeUser()
  const leased = yield* makeChunk(project, { leasedTo: holder })
  const matched = yield* makeMatchedChunk(project, holder)
  const a = yield* makeChunk(project)
  const b = yield* makeChunk(project)
  const parent = yield* makeChunk(project)
  yield* chunkState.fuse({ projectId: project.id, parentId: parent.id, memberIds: [a.id, b.id] })

  for (const chunkId of [leased.id, matched.id, a.id]) {
    const before = yield* chunkRow(chunkId)
    const claimed = yield* chunkState.claim({ chunkId, projectId: project.id, userId: other, leaseToken: randomUUID(), leaseHours: 24 })
    assert.equal(claimed, undefined)
    assert.deepEqual(yield* chunkRow(chunkId), before)
  }
}))

dbTest("claim refuses a chunk of another project", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject()
  const elsewhere = yield* makeProject()
  const user = yield* makeUser()
  const chunk = yield* makeChunk(project)
  const claimed = yield* chunkState.claim({ chunkId: chunk.id, projectId: elsewhere.id, userId: user, leaseToken: randomUUID(), leaseHours: 24 })
  assert.equal(claimed, undefined)
  assert.equal((yield* chunkRow(chunk.id)).state, "open")
}))

dbTest("competing leases stop at max_concurrent_leases, one per user", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject({ maxConcurrentLeases: 3 })
  const holder = yield* makeUser()
  const [second, third, fourth] = [yield* makeUser(), yield* makeUser(), yield* makeUser()]
  const chunk = yield* makeChunk(project, { leasedTo: holder })
  const add = (userId: string) =>
    chunkState.addCompetingLease({ chunkId: chunk.id, projectId: project.id, userId, leaseToken: randomUUID() })

  assert.equal(yield* add(holder), undefined, "the holder cannot also compete")
  assert.notEqual(yield* add(second), undefined)
  assert.equal(yield* add(second), undefined, "one competing lease per user")
  assert.notEqual(yield* add(third), undefined)
  assert.equal(yield* add(fourth), undefined, "three leases is the limit")
  assert.equal((yield* competingLeases(chunk.id)).length, 2)
}))

dbTest("competing leases need a leased chunk and a project that allows them", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const single = yield* makeProject({ maxConcurrentLeases: 1 })
  const shared = yield* makeProject({ maxConcurrentLeases: 2 })
  const holder = yield* makeUser()
  const other = yield* makeUser()
  const onSingle = yield* makeChunk(single, { leasedTo: holder })
  const open = yield* makeChunk(shared)

  assert.equal(
    yield* chunkState.addCompetingLease({ chunkId: onSingle.id, projectId: single.id, userId: other, leaseToken: randomUUID() }),
    undefined
  )
  assert.equal(
    yield* chunkState.addCompetingLease({ chunkId: open.id, projectId: shared.id, userId: other, leaseToken: randomUUID() }),
    undefined
  )
}))

dbTest("a heartbeat extends the lease by lease_hours, never past max_hold_hours", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject({ leaseHours: 10, maxHoldHours: 48 })
  const user = yield* makeUser()
  const fresh = yield* makeChunk(project, { leasedTo: user, expiresIn: "1 hour", heldFor: "2 hours" })
  const old = yield* makeChunk(project, { leasedTo: user, expiresIn: "1 hour", heldFor: "44 hours" })

  assert.ok(yield* chunkState.extendLease({ chunkId: fresh.id, projectSlug: project.slug, userId: user, leaseToken: fresh.leaseToken! }))
  assert.equal((yield* chunkRow(fresh.id)).lease_expires_at?.getTime(), (yield* at("10 hours")).getTime())

  assert.ok(yield* chunkState.extendLease({ chunkId: old.id, projectSlug: project.slug, userId: user, leaseToken: old.leaseToken! }))
  assert.equal(
    (yield* chunkRow(old.id)).lease_expires_at?.getTime(),
    (yield* at("4 hours")).getTime(),
    "capped at hold start + 48 hours"
  )
}))

dbTest("a heartbeat refuses an expired lease, a wrong token, and a hold past its limit", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject({ leaseHours: 10, maxHoldHours: 48 })
  const user = yield* makeUser()
  const expired = yield* makeChunk(project, { leasedTo: user, expiresIn: "-1 minute" })
  const live = yield* makeChunk(project, { leasedTo: user })
  const overHeld = yield* makeChunk(project, { leasedTo: user, expiresIn: "1 hour", heldFor: "49 hours" })
  const extend = (chunkId: string, leaseToken: string) =>
    chunkState.extendLease({ chunkId, projectSlug: project.slug, userId: user, leaseToken })

  assert.equal(yield* extend(expired.id, expired.leaseToken!), false, "audit A-010: expired before the sweep is still expired")
  assert.equal(yield* extend(live.id, randomUUID()), false)
  assert.equal(yield* extend(overHeld.id, overHeld.leaseToken!), false)
  assert.equal(
    yield* chunkState.extendLease({ chunkId: live.id, projectSlug: "some-other-project", userId: user, leaseToken: live.leaseToken! }),
    false
  )
}))

dbTest("ending a lease promotes the oldest live competing lease", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject({ maxConcurrentLeases: 4 })
  const holder = yield* makeUser()
  const [expiredSide, first, second] = [yield* makeUser(), yield* makeUser(), yield* makeUser()]
  const chunk = yield* makeChunk(project, { leasedTo: holder })
  yield* addSide(chunk.id, expiredSide, { createdAgo: "3 hours", expiresIn: "-1 minute" })
  const firstToken = yield* addSide(chunk.id, first, { createdAgo: "2 hours" })
  yield* addSide(chunk.id, second, { createdAgo: "1 hour" })

  assert.equal(yield* chunkState.endPrimaryLease(chunk.id, project.id), "promoted")
  const row = yield* chunkRow(chunk.id)
  assert.equal(row.state, "leased")
  assert.equal(row.lease_user_id, first, "the expired competing lease is skipped")
  assert.equal(row.lease_token, firstToken)
  assert.equal(row.hold_started_at?.getTime(), (yield* at("-2 hours")).getTime(), "the hold keeps its own start")
  const left = (yield* competingLeases(chunk.id)).map((lease) => lease.user_id)
  assert.deepEqual(left, [expiredSide, second], "the promoted lease is no longer competing")
  yield* assertBoard(project)
}))

dbTest("ending a lease with no one waiting returns the chunk to the pool", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject()
  const user = yield* makeUser()
  const chunk = yield* makeChunk(project, { leasedTo: user })

  assert.equal(yield* chunkState.endPrimaryLease(chunk.id, project.id), "returned")
  const row = yield* chunkRow(chunk.id)
  assert.equal(row.state, "open")
  assert.equal(row.lease_user_id, null)
  assert.equal(row.lease_token, null)
  assert.equal(row.lease_expires_at, null)
  assert.equal(row.hold_started_at, null)
  yield* assertBoard(project)
}))

dbTest("a chunk whose match was invalidated goes back to the pool as stale", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject()
  const user = yield* makeUser()
  const matched = yield* makeMatchedChunk(project, user)
  assert.ok(yield* chunkState.goStale({ chunkId: matched.id, projectId: project.id, reason: "test" }))
  const leaseToken = randomUUID()
  yield* chunkState.claim({ chunkId: matched.id, projectId: project.id, userId: user, leaseToken, leaseHours: 24 })

  assert.equal(yield* chunkState.endPrimaryLease(matched.id, project.id), "returned")
  assert.equal((yield* chunkRow(matched.id)).state, "stale")
}))

dbTest("releasing a competing lease leaves the holder alone", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject({ maxConcurrentLeases: 2 })
  const holder = yield* makeUser()
  const other = yield* makeUser()
  const chunk = yield* makeChunk(project, { leasedTo: holder })
  const token = yield* addSide(chunk.id, other, { createdAgo: "1 hour" })

  assert.equal(yield* chunkState.releaseCompetingLease({ chunkId: chunk.id, userId: other, leaseToken: randomUUID() }), false)
  assert.ok(yield* chunkState.releaseCompetingLease({ chunkId: chunk.id, userId: other, leaseToken: token }))
  assert.equal(yield* chunkState.releaseCompetingLease({ chunkId: chunk.id, userId: other, leaseToken: token }), false, "once")
  assert.equal((yield* competingLeases(chunk.id)).length, 0)
  assert.equal((yield* chunkRow(chunk.id)).lease_user_id, holder)
}))

dbTest("a maintainer's clear returns the chunk and ends every competing lease", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject({ maxConcurrentLeases: 3 })
  const holder = yield* makeUser()
  const chunk = yield* makeChunk(project, { leasedTo: holder })
  yield* addSide(chunk.id, yield* makeUser(), { createdAgo: "2 hours" })
  yield* addSide(chunk.id, yield* makeUser(), { createdAgo: "1 hour" })

  assert.ok(yield* chunkState.returnToPool(chunk.id, project.id))
  assert.equal((yield* chunkRow(chunk.id)).state, "open")
  assert.equal((yield* competingLeases(chunk.id)).length, 0)
  assert.equal(yield* chunkState.returnToPool(chunk.id, project.id), false, "nothing left to clear")
  yield* assertBoard(project)
}))

dbTest("ending a user's leases covers one project or all, and leaves validating chunks", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const here = yield* makeProject({ maxConcurrentLeases: 2 })
  const there = yield* makeProject()
  const user = yield* makeUser()
  const other = yield* makeUser()
  const heldHere = yield* makeChunk(here, { leasedTo: user })
  const sideHere = yield* makeChunk(here, { leasedTo: other })
  yield* addSide(sideHere.id, user, { createdAgo: "1 hour" })
  const heldThere = yield* makeChunk(there, { leasedTo: user })
  const checking = yield* makeChunk(there, { leasedTo: user })
  yield* chunkState.startValidating({ chunkId: checking.id, userId: user, leaseToken: checking.leaseToken!, primary: true })

  const touched = yield* chunkState.endUserLeases({ userId: user, projectId: here.id })
  assert.deepEqual(touched, [here.id])
  assert.equal((yield* chunkRow(heldHere.id)).state, "open")
  assert.equal((yield* competingLeases(sideHere.id)).length, 0)
  assert.equal((yield* chunkRow(sideHere.id)).lease_user_id, other, "someone else's lease stays")
  assert.equal((yield* chunkRow(heldThere.id)).state, "leased", "other projects are untouched")

  assert.deepEqual(yield* chunkState.endUserLeases({ userId: user }), [there.id])
  assert.equal((yield* chunkRow(heldThere.id)).state, "open")
  assert.equal((yield* chunkRow(checking.id)).state, "validating")
  yield* assertBoard(here)
  yield* assertBoard(there)
}))

dbTest("expiry uses the database clock and promotes or returns", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject({ maxConcurrentLeases: 2 })
  const user = yield* makeUser()
  const waiting = yield* makeUser()
  const live = yield* makeChunk(project, { leasedTo: user, expiresIn: "1 minute" })
  const lapsed = yield* makeChunk(project, { leasedTo: user, expiresIn: "-1 minute" })
  const contested = yield* makeChunk(project, { leasedTo: user, expiresIn: "-1 minute" })
  yield* addSide(contested.id, waiting, { createdAgo: "1 hour" })

  assert.equal(yield* chunkState.expireLease(live.id, project.id), false)
  assert.equal((yield* chunkRow(live.id)).lease_user_id, user)
  assert.ok(yield* chunkState.expireLease(lapsed.id, project.id))
  assert.equal((yield* chunkRow(lapsed.id)).state, "open")
  assert.ok(yield* chunkState.expireLease(contested.id, project.id))
  assert.equal((yield* chunkRow(contested.id)).lease_user_id, waiting)
  yield* assertBoard(project)
}))

dbTest("expired competing leases end; live ones stay", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const project = yield* makeProject({ maxConcurrentLeases: 3 })
  const holder = yield* makeUser()
  const lapsedUser = yield* makeUser()
  const liveUser = yield* makeUser()
  const chunk = yield* makeChunk(project, { leasedTo: holder })
  yield* addSide(chunk.id, lapsedUser, { createdAgo: "2 hours", expiresIn: "-1 minute" })
  yield* addSide(chunk.id, liveUser, { createdAgo: "1 hour" })

  const ended = (yield* chunkState.expireCompetingLeases).filter((row) => row.chunk_id === chunk.id)
  assert.deepEqual(ended.map((row) => row.user_id), [lapsedUser])
  assert.deepEqual((yield* competingLeases(chunk.id)).map((lease) => lease.user_id), [liveUser])
}))

dbTest("blocking for an unresolved type, and unblocking to open or stale", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const sql = yield* SqlClient.SqlClient
  const project = yield* makeProject()
  const user = yield* makeUser()
  const plain = yield* makeChunk(project)
  const twice = yield* makeChunk(project)
  const wasMatched = yield* makeMatchedChunk(project, user)
  const leased = yield* makeChunk(project, { leasedTo: user })
  yield* chunkState.goStale({ chunkId: wasMatched.id, projectId: project.id, reason: "test" })
  for (const id of [plain.id, twice.id, wasMatched.id, leased.id]) {
    yield* sql`INSERT INTO chunk_type_refs (chunk_id, type_name) VALUES (${id}, ${"Header"})`.pipe(Effect.orDie)
  }
  yield* sql`INSERT INTO chunk_type_refs (chunk_id, type_name) VALUES (${twice.id}, ${"Footer"})`.pipe(Effect.orDie)
  for (const name of ["Header", "Footer"]) {
    yield* sql`INSERT INTO unresolved_types (project_id, type_name) VALUES (${project.id}, ${name})`.pipe(Effect.orDie)
  }

  yield* chunkState.blockForType(project.id, "Header")
  yield* chunkState.blockForType(project.id, "Footer")
  for (const id of [plain.id, twice.id, wasMatched.id]) assert.equal((yield* chunkRow(id)).state, "blocked")
  assert.equal((yield* chunkRow(leased.id)).state, "leased", "a lease in progress is not taken away")
  yield* assertBoard(project)

  yield* sql`UPDATE unresolved_types SET cleared_at = now() WHERE project_id = ${project.id} AND type_name = ${"Header"}`.pipe(Effect.orDie)
  yield* chunkState.unblockForType(project.id, "Header")
  assert.equal((yield* chunkRow(plain.id)).state, "open")
  assert.equal((yield* chunkRow(wasMatched.id)).state, "stale", "an invalidated match makes it stale")
  assert.equal((yield* chunkRow(twice.id)).state, "blocked", "still blocked by Footer")
  yield* assertBoard(project)
}))

dbTest("fusing blocks the members under the parent and invalidates their matches", Effect.gen(function*() {
  const chunkState = yield* ChunkState
  const sql = yield* SqlClient.SqlClient
  const project = yield* makeProject()
  const user = yield* makeUser()
  const open = yield* makeChunk(project)
  const matched = yield* makeMatchedChunk(project, user)
  const parent = yield* makeChunk(project)

  yield* chunkState.fuse({ projectId: project.id, parentId: parent.id, memberIds: [open.id, matched.id] })
  for (const id of [open.id, matched.id]) {
    const row = yield* chunkRow(id)
    assert.equal(row.state, "blocked")
    assert.equal(row.fuse_parent_id, parent.id)
    assert.equal(row.current_match_id, null)
  }
  const active = yield* sql<{ readonly n: number }>`
    SELECT COUNT(*)::int AS n FROM matches WHERE chunk_id = ${matched.id} AND invalidated_at IS NULL
  `.pipe(Effect.orDie)
  assert.equal(active[0]!.n, 0)
  yield* assertBoard(project)
}))
