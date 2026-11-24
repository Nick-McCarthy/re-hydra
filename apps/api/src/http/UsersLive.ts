import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../Api.js"
import { DirectoryRepo } from "../services/DirectoryRepo.js"
import { UsersRepo } from "../services/UsersRepo.js"
import { CurrentUser } from "./Authorization.js"

export const UsersLive = HttpApiBuilder.group(Api, "users", (handlers) =>
  handlers
    .handle("search", (request) =>
      Effect.gen(function*() {
        const repo = yield* DirectoryRepo
        return yield* repo.searchUsers(request.query.q)
      })
    )
    .handle("get", (request) =>
      Effect.gen(function*() {
        const repo = yield* UsersRepo
        return yield* repo.getPublicProfile(request.params.userId)
      })
    )
    .handle("matches", (request) =>
      Effect.gen(function*() {
        const repo = yield* UsersRepo
        return yield* repo.matches(request.params.userId, request.query)
      })
    )
    .handle("projects", (request) =>
      Effect.gen(function*() {
        const repo = yield* UsersRepo
        return yield* repo.projects(request.params.userId)
      })
    )
    .handle("myWork", () =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* UsersRepo
        return yield* repo.myWork(user.id)
      })
    )
    .handle("followState", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* DirectoryRepo
        return yield* repo.userFollowState(request.params.userId, user.id)
      })
    )
    .handle("follow", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* DirectoryRepo
        return yield* repo.followUser(request.params.userId, user.id)
      })
    )
    .handle("unfollow", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* DirectoryRepo
        return yield* repo.unfollowUser(request.params.userId, user.id)
      })
    )
)

export const DirectoryLive = HttpApiBuilder.group(Api, "directory", (handlers) =>
  handlers
    .handle("feed", () =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* DirectoryRepo
        return yield* repo.feed(user.id)
      })
    )
    .handle("followingUsers", () =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* DirectoryRepo
        return yield* repo.followingUsers(user.id)
      })
    )
    .handle("followingProjects", () =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const repo = yield* DirectoryRepo
        return yield* repo.followingProjects(user.id)
      })
    )
)
