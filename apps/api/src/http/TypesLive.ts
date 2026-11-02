import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../Api.js"
import { FuseRepo } from "../services/FuseRepo.js"
import { TypeProposalsRepo } from "../services/TypeProposalsRepo.js"
import { UnresolvedTypesRepo } from "../services/UnresolvedTypesRepo.js"
import { CurrentUser } from "./Authorization.js"

export const TypesLive = HttpApiBuilder.group(Api, "types", (handlers) =>
  handlers
    .handle("getEnvironment", (request) =>
      Effect.gen(function*() {
        const repo = yield* TypeProposalsRepo
        return yield* repo.currentEnvironment(request.params.projectSlug)
      })
    )
    .handle("listProposals", (request) =>
      Effect.gen(function*() {
        const repo = yield* TypeProposalsRepo
        return yield* repo.list(request.params.projectSlug)
      })
    )
    .handle("getProposal", (request) =>
      Effect.gen(function*() {
        const repo = yield* TypeProposalsRepo
        return yield* repo.get(
          request.params.projectSlug,
          request.params.proposalId
        )
      })
    )
    .handle("createProposal", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* TypeProposalsRepo
        return yield* repo.create(
          request.params.projectSlug,
          user.id,
          request.payload
        )
      })
    )
    .handle("startRevalidation", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* TypeProposalsRepo
        return yield* repo.startRevalidation(
          request.params.projectSlug,
          request.params.proposalId,
          user.id
        )
      })
    )
    .handle("acceptProposal", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* TypeProposalsRepo
        return yield* repo.accept(
          request.params.projectSlug,
          request.params.proposalId,
          user.id
        )
      })
    )
    .handle("listUnresolved", (request) =>
      Effect.gen(function*() {
        const repo = yield* UnresolvedTypesRepo
        return yield* repo.listActive(request.params.projectSlug)
      })
    )
    .handle("markUnresolved", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* UnresolvedTypesRepo
        return yield* repo.mark(
          request.params.projectSlug,
          user.id,
          request.payload
        )
      })
    )
    .handle("clearUnresolved", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* UnresolvedTypesRepo
        return yield* repo.clear(
          request.params.projectSlug,
          request.params.typeName,
          user.id
        )
      })
    )
    .handle("fuse", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* FuseRepo
        return yield* repo.fuse(
          request.params.projectSlug,
          user.id,
          request.payload
        )
      })
    )
)
