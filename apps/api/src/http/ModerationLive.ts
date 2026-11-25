import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Forbidden } from "effect/http-api/HttpApiError"
import { Api } from "../Api.js"
import { MalwareHashes } from "../services/MalwareHashes.js"
import { Moderation } from "../services/Moderation.js"
import { CurrentUser } from "./Authorization.js"

export const ReportsLive = HttpApiBuilder.group(Api, "reports", (handlers) =>
  handlers.handle("create", (request) =>
    Effect.gen(function*() {
      const user = yield* CurrentUser
      const moderation = yield* Moderation
      return yield* moderation.report(user.id, request.payload)
    })
  )
)

/**
 * The signed-in admin. `isAdmin` comes from the users row on every request
 * (session lookup), so revoking admin takes effect at once.
 */
const requireAdmin = Effect.gen(function*() {
  const user = yield* CurrentUser
  if (!user.isAdmin) return yield* new Forbidden()
  return user
})

export const AdminLive = HttpApiBuilder.group(Api, "admin", (handlers) =>
  handlers
    .handle("listReports", (request) =>
      Effect.gen(function*() {
        yield* requireAdmin
        return yield* (yield* Moderation).listReports(request.query.status ?? "open")
      })
    )
    .handle("resolveReport", (request) =>
      Effect.gen(function*() {
        const admin = yield* requireAdmin
        return yield* (yield* Moderation).resolveReport(admin.id, request.params.reportId, request.payload.resolution)
      })
    )
    .handle("searchProjects", (request) =>
      Effect.gen(function*() {
        yield* requireAdmin
        return yield* (yield* Moderation).searchProjects(request.query.q ?? "")
      })
    )
    .handle("archiveProject", (request) =>
      Effect.gen(function*() {
        const admin = yield* requireAdmin
        return yield* (yield* Moderation).archiveProject(admin.id, request.params.projectSlug, request.payload.note)
      })
    )
    .handle("restoreProject", (request) =>
      Effect.gen(function*() {
        const admin = yield* requireAdmin
        return yield* (yield* Moderation).restoreProject(admin.id, request.params.projectSlug, request.payload.note)
      })
    )
    .handle("removePost", (request) =>
      Effect.gen(function*() {
        const admin = yield* requireAdmin
        yield* (yield* Moderation).removePost(admin.id, request.params.postId, request.payload.note)
      })
    )
    .handle("searchUsers", (request) =>
      Effect.gen(function*() {
        yield* requireAdmin
        return yield* (yield* Moderation).searchUsers(request.query.q ?? "")
      })
    )
    .handle("suspendUser", (request) =>
      Effect.gen(function*() {
        const admin = yield* requireAdmin
        return yield* (yield* Moderation).suspendUser(admin.id, request.params.userId, request.payload.note)
      })
    )
    .handle("restoreUser", (request) =>
      Effect.gen(function*() {
        const admin = yield* requireAdmin
        return yield* (yield* Moderation).restoreUser(admin.id, request.params.userId, request.payload.note)
      })
    )
    .handle("listStrikes", (request) =>
      Effect.gen(function*() {
        yield* requireAdmin
        return yield* (yield* Moderation).listStrikes(request.params.userId)
      })
    )
    .handle("addStrike", (request) =>
      Effect.gen(function*() {
        const admin = yield* requireAdmin
        return yield* (yield* Moderation).addStrike(admin.id, request.params.userId, request.payload.note)
      })
    )
    .handle("reverseStrike", (request) =>
      Effect.gen(function*() {
        const admin = yield* requireAdmin
        return yield* (yield* Moderation).reverseStrike(admin.id, request.params.strikeId, request.payload.note)
      })
    )
    .handle("malwareOverview", () =>
      Effect.gen(function*() {
        yield* requireAdmin
        return yield* (yield* MalwareHashes).overview
      })
    )
    .handle("resolveMalwareHit", (request) =>
      Effect.gen(function*() {
        const admin = yield* requireAdmin
        return yield* (yield* MalwareHashes).resolveHit(admin.id, request.params.hitId, request.payload)
      })
    )
    .handle("listActions", (request) =>
      Effect.gen(function*() {
        yield* requireAdmin
        return yield* (yield* Moderation).listActions(request.query.limit ?? 100)
      })
    )
)
