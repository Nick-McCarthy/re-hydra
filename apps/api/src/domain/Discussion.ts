import { Schema } from "effect"
import { HttpApiError } from "effect/http-api"
import { Uuid } from "./Uuid.js"

/** Posting is not possible here: a locked thread, or an empty message. */
export class DiscussionRefused extends HttpApiError.Problem<DiscussionRefused>()("DiscussionRefused", {
  type: "https://re-hydra.dev/problems/discussion-refused",
  status: 409,
  title: "Post not possible"
}) {}

export const ThreadTitle = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(120))
export const PostBody = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(10_000))

export const ThreadSummary = Schema.Struct({
  id: Uuid,
  title: Schema.String,
  authorId: Schema.NullOr(Uuid),
  authorName: Schema.NullOr(Schema.String),
  chunkId: Schema.NullOr(Uuid),
  chunkName: Schema.NullOr(Schema.String),
  pinned: Schema.Boolean,
  locked: Schema.Boolean,
  /** Posts after the opening one, removed ones included. */
  replyCount: Schema.Int,
  createdAt: Schema.String,
  lastPostAt: Schema.String,
  lastPostBy: Schema.NullOr(Schema.String)
}).annotate({ identifier: "ThreadSummary" })
export type ThreadSummary = typeof ThreadSummary.Type

export const ThreadPage = Schema.Struct({
  items: Schema.Array(ThreadSummary),
  total: Schema.Int
}).annotate({ identifier: "ThreadPage" })
export type ThreadPage = typeof ThreadPage.Type

export const DiscussionPost = Schema.Struct({
  id: Uuid,
  authorId: Schema.NullOr(Uuid),
  authorName: Schema.NullOr(Schema.String),
  /** Empty when the post was removed. */
  body: Schema.String,
  createdAt: Schema.String,
  editedAt: Schema.NullOr(Schema.String),
  deleted: Schema.Boolean
}).annotate({ identifier: "DiscussionPost" })
export type DiscussionPost = typeof DiscussionPost.Type

export const ThreadDetail = Schema.Struct({
  thread: ThreadSummary,
  posts: Schema.Array(DiscussionPost)
}).annotate({ identifier: "ThreadDetail" })
export type ThreadDetail = typeof ThreadDetail.Type

export const CreateThreadPayload = Schema.Struct({
  title: ThreadTitle,
  body: PostBody,
  chunkId: Schema.optionalKey(Uuid)
}).annotate({ identifier: "CreateThreadPayload" })
export type CreateThreadPayload = typeof CreateThreadPayload.Type

export const PostPayload = Schema.Struct({
  body: PostBody
}).annotate({ identifier: "PostPayload" })
export type PostPayload = typeof PostPayload.Type

export const UpdateThreadPayload = Schema.Struct({
  title: Schema.optionalKey(ThreadTitle),
  pinned: Schema.optionalKey(Schema.Boolean),
  locked: Schema.optionalKey(Schema.Boolean)
}).annotate({ identifier: "UpdateThreadPayload" })
export type UpdateThreadPayload = typeof UpdateThreadPayload.Type
