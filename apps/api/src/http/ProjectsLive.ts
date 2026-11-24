import { Effect } from "effect"
import { ProjectModeration } from "../services/ProjectModeration.js"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../Api.js"
import { DirectoryRepo } from "../services/DirectoryRepo.js"
import { IntegrationsRepo } from "../services/IntegrationsRepo.js"
import { ProjectsRepo } from "../services/ProjectsRepo.js"
import { CurrentUser } from "./Authorization.js"

export const ProjectsLive = HttpApiBuilder.group(Api, "projects", (handlers) =>
  handlers
    .handle("list", (request) =>
      Effect.gen(function*() {
        const repo = yield* ProjectsRepo
        return yield* repo.list(request.query)
      })
    )
    .handle("get", (request) =>
      Effect.gen(function*() {
        const repo = yield* ProjectsRepo
        return yield* repo.getBySlug(request.params.projectSlug)
      })
    )
    .handle("membership", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* ProjectsRepo
        return yield* repo.membership(request.params.projectSlug, user.id)
      })
    )
    .handle("listBlocks", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const moderation = yield* ProjectModeration
        return yield* moderation.listBlocks(request.params.projectSlug, user.id)
      })
    )
    .handle("block", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const moderation = yield* ProjectModeration
        return yield* moderation.block(request.params.projectSlug, user.id, request.payload)
      })
    )
    .handle("unblock", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const moderation = yield* ProjectModeration
        return yield* moderation.unblock(request.params.projectSlug, user.id, request.params.userId)
      })
    )
    .handle("create", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* ProjectsRepo
        return yield* repo.create(user.id, request.payload)
      })
    )
    .handle("activity", (request) =>
      Effect.gen(function*() {
        const repo = yield* DirectoryRepo
        return yield* repo.activity(request.params.projectSlug)
      })
    )
    .handle("followState", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* DirectoryRepo
        return yield* repo.projectFollowState(request.params.projectSlug, user.id)
      })
    )
    .handle("follow", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* DirectoryRepo
        return yield* repo.followProject(request.params.projectSlug, user.id)
      })
    )
    .handle("unfollow", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* DirectoryRepo
        return yield* repo.unfollowProject(request.params.projectSlug, user.id)
      })
    )
    .handle("updateSettings", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* ProjectsRepo
        return yield* repo.updateSettings(
          request.params.projectSlug,
          user.id,
          request.payload
        )
      })
    )
    .handle("listIntegrations", (request) =>
      Effect.gen(function*() {
        const repo = yield* IntegrationsRepo
        return yield* repo.list(request.params.projectSlug)
      })
    )
    .handle("getIntegration", (request) =>
      Effect.gen(function*() {
        const repo = yield* IntegrationsRepo
        return yield* repo.get(
          request.params.projectSlug,
          request.params.integrationId
        )
      })
    )
    .handle("startIntegration", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* IntegrationsRepo
        return yield* repo.start(
          request.params.projectSlug,
          user.id,
          request.payload
        )
      })
    )
)
