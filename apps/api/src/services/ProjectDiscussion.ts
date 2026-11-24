import { Context, Effect, Layer } from "effect"
import { Forbidden, NotFound } from "effect/http-api/HttpApiError"
import { SqlClient } from "effect/sql"
import {
  type CreateThreadPayload,
  type DiscussionPost,
  DiscussionRefused,
  type PostPayload,
  type ThreadDetail,
  type ThreadPage,
  type ThreadSummary,
  type UpdateThreadPayload
} from "../domain/Discussion.js"
import type { ProjectAccessDenied } from "../domain/Project.js"
import type { Uuid } from "../domain/Uuid.js"
import { Activity } from "./Activity.js"
import { type MemberRole, ProjectAuth } from "./ProjectAuth.js"

const toIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const DEFAULT_LIMIT = 30

type WriteError = NotFound | ProjectAccessDenied | DiscussionRefused
type ModerateError = NotFound | Forbidden | ProjectAccessDenied | DiscussionRefused

/**
 * Project discussion: threads with a flat list of posts.
 *
 * - Anyone can read. Anyone who may work on the project (ProjectAuth.
 *   requireContributor: not blocked, and a member when the project is
 *   members-only) can start threads and reply.
 * - Authors edit and remove their own posts. Owners and maintainers remove
 *   any post, pin, lock, and remove threads. Authors may retitle their own
 *   thread and remove it.
 * - A locked thread takes no replies or edits. Removing a post keeps its
 *   place ("post removed"); removing a thread hides it from the list.
 * - Only "X started a thread" reaches the activity feed.
 */
export class ProjectDiscussion extends Context.Service<
  ProjectDiscussion,
  {
    readonly list: (
      projectSlug: string,
      query: { readonly chunkId?: Uuid | undefined; readonly limit?: number | undefined; readonly offset?: number | undefined }
    ) => Effect.Effect<ThreadPage, NotFound>
    readonly get: (projectSlug: string, threadId: Uuid) => Effect.Effect<ThreadDetail, NotFound>
    readonly create: (
      projectSlug: string,
      userId: Uuid,
      payload: CreateThreadPayload
    ) => Effect.Effect<ThreadDetail, WriteError>
    readonly reply: (
      projectSlug: string,
      userId: Uuid,
      threadId: Uuid,
      payload: PostPayload
    ) => Effect.Effect<ThreadDetail, WriteError>
    readonly editPost: (
      projectSlug: string,
      userId: Uuid,
      threadId: Uuid,
      postId: Uuid,
      payload: PostPayload
    ) => Effect.Effect<ThreadDetail, ModerateError>
    readonly deletePost: (
      projectSlug: string,
      userId: Uuid,
      threadId: Uuid,
      postId: Uuid
    ) => Effect.Effect<ThreadDetail, NotFound | Forbidden>
    readonly updateThread: (
      projectSlug: string,
      userId: Uuid,
      threadId: Uuid,
      payload: UpdateThreadPayload
    ) => Effect.Effect<ThreadDetail, NotFound | Forbidden>
    readonly deleteThread: (
      projectSlug: string,
      userId: Uuid,
      threadId: Uuid
    ) => Effect.Effect<void, NotFound | Forbidden>
  }
>()("rehydra/services/ProjectDiscussion") {
  static readonly layer = Layer.effect(
    ProjectDiscussion,
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const auth = yield* ProjectAuth
      const activity = yield* Activity

      const findProject = (projectSlug: string) =>
        sql<{ readonly id: string }>`
          SELECT id FROM projects WHERE slug = ${projectSlug} AND archived_at IS NULL LIMIT 1
        `.pipe(
          Effect.orDie,
          Effect.flatMap((rows) => rows[0] === undefined ? Effect.fail(new NotFound()) : Effect.succeed(rows[0].id))
        )

      const roleOf = (projectId: string, userId: Uuid) =>
        sql<{ readonly role: MemberRole }>`
          SELECT role FROM project_members WHERE project_id = ${projectId} AND user_id = ${userId}
        `.pipe(Effect.orDie, Effect.map((rows) => rows[0]?.role ?? null))

      const isManager = (role: MemberRole | null) => role === "owner" || role === "maintainer"

      type ThreadRow = {
        readonly id: string
        readonly title: string
        readonly author_id: string | null
        readonly author_name: string | null
        readonly chunk_id: string | null
        readonly chunk_name: string | null
        readonly pinned: boolean
        readonly locked: boolean
        readonly reply_count: number
        readonly created_at: Date | string
        readonly last_post_at: Date | string
        readonly last_post_by: string | null
      }
      const toThread = (row: ThreadRow): ThreadSummary => ({
        id: row.id as Uuid,
        title: row.title,
        authorId: row.author_id as Uuid | null,
        authorName: row.author_name,
        chunkId: row.chunk_id as Uuid | null,
        chunkName: row.chunk_name,
        pinned: row.pinned,
        locked: row.locked,
        replyCount: Number(row.reply_count),
        createdAt: toIso(row.created_at),
        lastPostAt: toIso(row.last_post_at),
        lastPostBy: row.last_post_by
      })

      const threadRows = (
        projectId: string,
        filter: { readonly threadId: string | null; readonly chunkId: string | null; readonly limit: number; readonly offset: number }
      ) =>
        sql<ThreadRow>`
          SELECT t.id, t.title, t.author_id, au.display_name AS author_name,
                 t.chunk_id, c.name AS chunk_name, t.pinned, t.locked,
                 t.created_at, t.last_post_at,
                 (SELECT count(*)::int - 1 FROM project_posts pp WHERE pp.thread_id = t.id) AS reply_count,
                 (SELECT lu.display_name FROM project_posts lp
                    LEFT JOIN users lu ON lu.id = lp.author_id
                    WHERE lp.thread_id = t.id
                    ORDER BY lp.created_at DESC LIMIT 1) AS last_post_by
          FROM project_threads t
          LEFT JOIN users au ON au.id = t.author_id
          LEFT JOIN chunks c ON c.id = t.chunk_id
          WHERE t.project_id = ${projectId}
            AND t.deleted_at IS NULL
            AND (${filter.threadId}::uuid IS NULL OR t.id = ${filter.threadId}::uuid)
            AND (${filter.chunkId}::uuid IS NULL OR t.chunk_id = ${filter.chunkId}::uuid)
          ORDER BY t.pinned DESC, t.last_post_at DESC
          LIMIT ${filter.limit} OFFSET ${filter.offset}
        `.pipe(Effect.orDie, Effect.map((rows) => rows.map(toThread)))

      const detail = (projectId: string, threadId: string) =>
        Effect.gen(function*() {
          const threads = yield* threadRows(projectId, { threadId, chunkId: null, limit: 1, offset: 0 })
          const thread = threads[0]
          if (thread === undefined) return yield* new NotFound()
          const posts = yield* sql<{
            readonly id: string
            readonly author_id: string | null
            readonly author_name: string | null
            readonly body: string
            readonly created_at: Date | string
            readonly edited_at: Date | string | null
            readonly deleted_at: Date | string | null
          }>`
            SELECT p.id, p.author_id, u.display_name AS author_name, p.body,
                   p.created_at, p.edited_at, p.deleted_at
            FROM project_posts p
            LEFT JOIN users u ON u.id = p.author_id
            WHERE p.thread_id = ${threadId}
            ORDER BY p.created_at, p.id
          `.pipe(Effect.orDie)
          return {
            thread,
            posts: posts.map((p): DiscussionPost => ({
              id: p.id as Uuid,
              authorId: p.author_id as Uuid | null,
              authorName: p.author_name,
              body: p.deleted_at === null ? p.body : "",
              createdAt: toIso(p.created_at),
              editedAt: p.edited_at === null ? null : toIso(p.edited_at),
              deleted: p.deleted_at !== null
            }))
          } satisfies ThreadDetail
        })

      /** The thread row, locked for update, when it belongs to the project and is not removed. */
      const lockThread = (projectId: string, threadId: string) =>
        sql<{ readonly author_id: string | null; readonly locked: boolean }>`
          SELECT author_id, locked FROM project_threads
          WHERE id = ${threadId} AND project_id = ${projectId} AND deleted_at IS NULL
          FOR UPDATE
        `.pipe(
          Effect.orDie,
          Effect.flatMap((rows) => rows[0] === undefined ? Effect.fail(new NotFound()) : Effect.succeed(rows[0]))
        )

      const cleanBody = (body: string) => {
        const trimmed = body.trim()
        return trimmed.length === 0
          ? Effect.fail(new DiscussionRefused({ detail: "Write something first." }))
          : Effect.succeed(trimmed)
      }

      const inTransaction = <A, E>(effect: Effect.Effect<A, E>) =>
        sql.withTransaction(effect).pipe(Effect.catchTag("SqlError", (error) => Effect.die(error)))

      const list = Effect.fn("ProjectDiscussion.list")(function*(
        projectSlug: string,
        query: { readonly chunkId?: Uuid | undefined; readonly limit?: number | undefined; readonly offset?: number | undefined }
      ) {
        const projectId = yield* findProject(projectSlug)
        const chunkId = query.chunkId ?? null
        const items = yield* threadRows(projectId, {
          threadId: null,
          chunkId,
          limit: query.limit ?? DEFAULT_LIMIT,
          offset: query.offset ?? 0
        })
        const total = yield* sql<{ readonly total: number }>`
          SELECT count(*)::int AS total FROM project_threads
          WHERE project_id = ${projectId} AND deleted_at IS NULL
            AND (${chunkId}::uuid IS NULL OR chunk_id = ${chunkId}::uuid)
        `.pipe(Effect.orDie)
        return { items, total: Number(total[0]?.total ?? 0) } satisfies ThreadPage
      })

      const get = Effect.fn("ProjectDiscussion.get")(function*(projectSlug: string, threadId: Uuid) {
        const projectId = yield* findProject(projectSlug)
        return yield* detail(projectId, threadId)
      })

      const create = Effect.fn("ProjectDiscussion.create")(function*(
        projectSlug: string,
        userId: Uuid,
        payload: CreateThreadPayload
      ) {
        const { projectId } = yield* auth.requireContributor(projectSlug, userId)
        const title = payload.title.trim()
        if (title.length === 0) return yield* new DiscussionRefused({ detail: "Give the thread a title." })
        const body = yield* cleanBody(payload.body)
        const chunkId = payload.chunkId ?? null
        if (chunkId !== null) {
          const chunk = yield* sql<{ readonly id: string }>`
            SELECT id FROM chunks WHERE id = ${chunkId} AND project_id = ${projectId}
          `.pipe(Effect.orDie)
          if (chunk[0] === undefined) {
            return yield* new DiscussionRefused({ detail: "That chunk is not in this project." })
          }
        }
        const threadId = yield* inTransaction(Effect.gen(function*() {
          const inserted = yield* sql<{ readonly id: string }>`
            INSERT INTO project_threads (project_id, author_id, chunk_id, title)
            VALUES (${projectId}, ${userId}, ${chunkId}, ${title})
            RETURNING id
          `
          const id = inserted[0]!.id
          yield* sql`
            INSERT INTO project_posts (thread_id, author_id, body) VALUES (${id}, ${userId}, ${body})
          `
          const author = yield* sql<{ readonly display_name: string }>`
            SELECT display_name FROM users WHERE id = ${userId}
          `
          yield* activity.record({
            projectId,
            actorId: userId,
            kind: "thread_started",
            chunkId,
            summary: `${author[0]?.display_name ?? "Someone"} started a thread: ${title}`
          })
          return id
        }))
        return yield* detail(projectId, threadId)
      })

      const reply = Effect.fn("ProjectDiscussion.reply")(function*(
        projectSlug: string,
        userId: Uuid,
        threadId: Uuid,
        payload: PostPayload
      ) {
        const { projectId } = yield* auth.requireContributor(projectSlug, userId)
        const body = yield* cleanBody(payload.body)
        yield* inTransaction(Effect.gen(function*() {
          const thread = yield* lockThread(projectId, threadId)
          if (thread.locked) return yield* new DiscussionRefused({ detail: "This thread is locked." })
          yield* sql`
            INSERT INTO project_posts (thread_id, author_id, body) VALUES (${threadId}, ${userId}, ${body})
          `
          yield* sql`UPDATE project_threads SET last_post_at = now() WHERE id = ${threadId}`
        }))
        return yield* detail(projectId, threadId)
      })

      const editPost = Effect.fn("ProjectDiscussion.editPost")(function*(
        projectSlug: string,
        userId: Uuid,
        threadId: Uuid,
        postId: Uuid,
        payload: PostPayload
      ) {
        const { projectId } = yield* auth.requireContributor(projectSlug, userId)
        const body = yield* cleanBody(payload.body)
        yield* inTransaction(Effect.gen(function*() {
          const thread = yield* lockThread(projectId, threadId)
          if (thread.locked) return yield* new DiscussionRefused({ detail: "This thread is locked." })
          const posts = yield* sql<{ readonly author_id: string | null }>`
            SELECT author_id FROM project_posts
            WHERE id = ${postId} AND thread_id = ${threadId} AND deleted_at IS NULL
          `
          if (posts[0] === undefined) return yield* new NotFound()
          if (posts[0].author_id !== userId) return yield* new Forbidden()
          yield* sql`UPDATE project_posts SET body = ${body}, edited_at = now() WHERE id = ${postId}`
        }))
        return yield* detail(projectId, threadId)
      })

      const deletePost = Effect.fn("ProjectDiscussion.deletePost")(function*(
        projectSlug: string,
        userId: Uuid,
        threadId: Uuid,
        postId: Uuid
      ) {
        const projectId = yield* findProject(projectSlug)
        const role = yield* roleOf(projectId, userId)
        yield* inTransaction(Effect.gen(function*() {
          yield* lockThread(projectId, threadId)
          const posts = yield* sql<{ readonly author_id: string | null }>`
            SELECT author_id FROM project_posts
            WHERE id = ${postId} AND thread_id = ${threadId} AND deleted_at IS NULL
          `
          if (posts[0] === undefined) return yield* new NotFound()
          if (posts[0].author_id !== userId && !isManager(role)) return yield* new Forbidden()
          yield* sql`
            UPDATE project_posts SET deleted_at = now(), deleted_by = ${userId} WHERE id = ${postId}
          `
        }))
        return yield* detail(projectId, threadId)
      })

      const updateThread = Effect.fn("ProjectDiscussion.updateThread")(function*(
        projectSlug: string,
        userId: Uuid,
        threadId: Uuid,
        payload: UpdateThreadPayload
      ) {
        const projectId = yield* findProject(projectSlug)
        const role = yield* roleOf(projectId, userId)
        yield* inTransaction(Effect.gen(function*() {
          const thread = yield* lockThread(projectId, threadId)
          const moderates = payload.pinned !== undefined || payload.locked !== undefined
          if (moderates && !isManager(role)) return yield* new Forbidden()
          if (payload.title !== undefined && thread.author_id !== userId && !isManager(role)) {
            return yield* new Forbidden()
          }
          const title = payload.title?.trim() ?? null
          yield* sql`
            UPDATE project_threads SET
              title = COALESCE(NULLIF(${title}::text, ''), title),
              pinned = COALESCE(${payload.pinned ?? null}::boolean, pinned),
              locked = COALESCE(${payload.locked ?? null}::boolean, locked)
            WHERE id = ${threadId}
          `
        }))
        return yield* detail(projectId, threadId)
      })

      const deleteThread = Effect.fn("ProjectDiscussion.deleteThread")(function*(
        projectSlug: string,
        userId: Uuid,
        threadId: Uuid
      ) {
        const projectId = yield* findProject(projectSlug)
        const role = yield* roleOf(projectId, userId)
        yield* inTransaction(Effect.gen(function*() {
          const thread = yield* lockThread(projectId, threadId)
          if (thread.author_id !== userId && !isManager(role)) return yield* new Forbidden()
          yield* sql`
            UPDATE project_threads SET deleted_at = now(), deleted_by = ${userId} WHERE id = ${threadId}
          `
        }))
      })

      return ProjectDiscussion.of({ list, get, create, reply, editPost, deletePost, updateThread, deleteThread })
    })
  )
}
