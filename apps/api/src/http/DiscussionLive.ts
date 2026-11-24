import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../Api.js"
import { ProjectDiscussion } from "../services/ProjectDiscussion.js"
import { CurrentUser } from "./Authorization.js"

export const DiscussionLive = HttpApiBuilder.group(Api, "discussion", (handlers) =>
  handlers
    .handle("listThreads", (request) =>
      Effect.gen(function*() {
        const discussion = yield* ProjectDiscussion
        return yield* discussion.list(request.params.projectSlug, request.query)
      })
    )
    .handle("getThread", (request) =>
      Effect.gen(function*() {
        const discussion = yield* ProjectDiscussion
        return yield* discussion.get(request.params.projectSlug, request.params.threadId)
      })
    )
    .handle("createThread", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const discussion = yield* ProjectDiscussion
        return yield* discussion.create(request.params.projectSlug, user.id, request.payload)
      })
    )
    .handle("updateThread", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const discussion = yield* ProjectDiscussion
        return yield* discussion.updateThread(
          request.params.projectSlug,
          user.id,
          request.params.threadId,
          request.payload
        )
      })
    )
    .handle("deleteThread", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const discussion = yield* ProjectDiscussion
        return yield* discussion.deleteThread(request.params.projectSlug, user.id, request.params.threadId)
      })
    )
    .handle("reply", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const discussion = yield* ProjectDiscussion
        return yield* discussion.reply(
          request.params.projectSlug,
          user.id,
          request.params.threadId,
          request.payload
        )
      })
    )
    .handle("editPost", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const discussion = yield* ProjectDiscussion
        return yield* discussion.editPost(
          request.params.projectSlug,
          user.id,
          request.params.threadId,
          request.params.postId,
          request.payload
        )
      })
    )
    .handle("deletePost", (request) =>
      Effect.gen(function*() {
        const user = yield* CurrentUser
        const discussion = yield* ProjectDiscussion
        return yield* discussion.deletePost(
          request.params.projectSlug,
          user.id,
          request.params.threadId,
          request.params.postId
        )
      })
    )
)
