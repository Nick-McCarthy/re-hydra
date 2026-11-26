import { Effect } from "effect"
import { NotFound } from "effect/http-api/HttpApiError"
import type { SqlClient } from "effect/sql"
import { ChunkRefused, chunkChanged } from "../domain/Problems.js"

/**
 * Why a lease operation found nothing to change. Run after the conditional
 * update matched no row, so the answer reflects the chunk as it is now.
 *
 * `checkout` explains why the chunk cannot be taken. `lease` explains why a
 * lease token no longer works (heartbeat, release, submit, bundle).
 */
export const explainChunkRefusal = Effect.fn("explainChunkRefusal")(function*(
  sql: SqlClient.SqlClient,
  input: {
    readonly projectSlug: string
    readonly chunkId: string
    readonly userId: string
    readonly purpose: "checkout" | "lease"
    readonly leaseToken?: string
  }
) {
  const rows = yield* sql<{
    readonly state: string
    readonly lease_user_id: string | null
    readonly lease_token: string | null
    readonly expired: boolean
    readonly hold_over: boolean
    readonly fused: boolean
  }>`
    SELECT
      c.state,
      c.lease_user_id,
      c.lease_token,
      COALESCE(c.lease_expires_at <= now(), false) AS expired,
      COALESCE(now() >= c.hold_started_at + make_interval(hours => p.max_hold_hours), false) AS hold_over,
      c.fuse_parent_id IS NOT NULL AS fused
    FROM chunks c
    INNER JOIN projects p ON p.id = c.project_id
    WHERE p.slug = ${input.projectSlug}
      AND c.id = ${input.chunkId}
    LIMIT 1
  `.pipe(Effect.orDie)
  const chunk = rows[0]
  if (chunk === undefined) return yield* new NotFound()

  const side = yield* sql<{
    readonly lease_token: string
    readonly released: boolean
    readonly expired: boolean
  }>`
    SELECT lease_token, released_at IS NOT NULL AS released, lease_expires_at <= now() AS expired
    FROM chunk_leases
    WHERE chunk_id = ${input.chunkId}
      AND user_id = ${input.userId}
    ORDER BY created_at DESC
  `.pipe(Effect.orDie)

  if (chunk.fused) {
    return yield* new ChunkRefused({
      reason: "fused",
      detail: "This function is part of a fused chunk. Work on the fused chunk instead."
    })
  }
  if (chunk.state === "matched" && input.purpose === "checkout") {
    return yield* new ChunkRefused({ reason: "matched", detail: "This chunk is already matched." })
  }
  if (chunk.state === "blocked") {
    return yield* new ChunkRefused({ reason: "blocked", detail: "A maintainer has blocked this chunk." })
  }

  if (input.purpose === "checkout") {
    const holdsSide = side.some((row) => !row.released && !row.expired)
    if (chunk.lease_user_id === input.userId || holdsSide) {
      return yield* new ChunkRefused({ reason: "already_held", detail: "You already hold this chunk." })
    }
    if (chunk.state === "validating") {
      return yield* new ChunkRefused({
        reason: "validating",
        detail: "Someone's submission for this chunk is being checked."
      })
    }
    if (chunk.state === "leased") {
      return yield* new ChunkRefused({ reason: "taken", detail: "Someone else holds this chunk." })
    }
    return yield* chunkChanged()
  }

  // A lease token: the primary lease on the chunk row, or an extra one in chunk_leases.
  const token = input.leaseToken
  const isPrimary = token !== undefined && chunk.lease_user_id === input.userId && chunk.lease_token === token
  const extra = token === undefined ? undefined : side.find((row) => row.lease_token === token)

  if (isPrimary || (extra !== undefined && !extra.released)) {
    if (chunk.state === "validating") {
      return yield* new ChunkRefused({
        reason: "validating",
        detail: "A submission for this chunk is being checked. Wait for its result."
      })
    }
    if (isPrimary ? chunk.expired : extra?.expired === true) {
      return yield* new ChunkRefused({ reason: "lease_gone", detail: "Your lease expired. Check the chunk out again." })
    }
    if (isPrimary && chunk.hold_over) {
      return yield* new ChunkRefused({
        reason: "lease_gone",
        detail: "You have held this chunk for the project's maximum hold time, so the lease cannot be extended."
      })
    }
    return yield* chunkChanged()
  }
  if (extra !== undefined && extra.released) {
    return yield* new ChunkRefused({ reason: "lease_gone", detail: "This lease was released." })
  }
  if (chunk.state === "matched") {
    return yield* new ChunkRefused({ reason: "matched", detail: "This chunk is already matched." })
  }
  return yield* new ChunkRefused({
    reason: "lease_gone",
    detail: "This lease is no longer yours: it expired, was released, or was cleared by a maintainer."
  })
})
