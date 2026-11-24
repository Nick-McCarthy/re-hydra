import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../Api.js"
import { AttemptsRepo } from "../services/AttemptsRepo.js"
import { ChunksRepo } from "../services/ChunksRepo.js"
import { WorkBundles } from "../services/WorkBundles.js"
import { CurrentUser } from "./Authorization.js"

export const ChunksLive = HttpApiBuilder.group(Api, "chunks", (handlers) =>
  handlers
    .handle("list", (request) =>
      Effect.gen(function*() {
        const repo = yield* ChunksRepo
        return yield* repo.listByProjectSlug(request.params.projectSlug, request.query)
      })
    )
    .handle("get", (request) =>
      Effect.gen(function*() {
        const repo = yield* ChunksRepo
        return yield* repo.getByProjectSlug(
          request.params.projectSlug,
          request.params.chunkId
        )
      })
    )
    .handle("bundle", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const bundles = yield* WorkBundles
        return yield* bundles.getForLeaseHolder(
          request.params.projectSlug,
          request.params.chunkId,
          user.id
        )
      })
    )
    .handle("checkout", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const bundles = yield* WorkBundles
        return yield* bundles.checkoutWithBundle(
          request.params.projectSlug,
          request.params.chunkId,
          user.id
        )
      })
    )
    .handle("release", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* ChunksRepo
        return yield* repo.release(
          request.params.projectSlug,
          request.params.chunkId,
          user.id,
          request.payload.leaseToken
        )
      })
    )
    .handle("heartbeat", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* ChunksRepo
        return yield* repo.heartbeat(
          request.params.projectSlug,
          request.params.chunkId,
          user.id,
          request.payload.leaseToken
        )
      })
    )
    .handle("submit", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* AttemptsRepo
        return yield* repo.submit({
          projectSlug: request.params.projectSlug,
          chunkId: request.params.chunkId,
          userId: user.id,
          leaseToken: request.payload.leaseToken,
          source: request.payload.source
        })
      })
    )
    .handle("listAttempts", (request) =>
      Effect.gen(function*() {
        const repo = yield* AttemptsRepo
        return yield* repo.listByChunk(
          request.params.projectSlug,
          request.params.chunkId
        )
      })
    )
    .handle("setLanguage", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* ChunksRepo
        return yield* repo.setLanguage(
          request.params.projectSlug,
          request.params.chunkId,
          user.id,
          request.payload
        )
      })
    )
    .handle("setInlineAsm", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* ChunksRepo
        return yield* repo.setInlineAsm(
          request.params.projectSlug,
          request.params.chunkId,
          user.id,
          request.payload.allow
        )
      })
    )
    .handle("clearLease", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* ChunksRepo
        return yield* repo.clearLease(
          request.params.projectSlug,
          request.params.chunkId,
          user.id
        )
      })
    )
)
