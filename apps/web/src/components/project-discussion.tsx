import * as React from "react"
import { Link } from "react-router-dom"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ReportButton } from "@/components/report-button"
import { ApiError, api, type DiscussionPost, type ThreadDetail, type ThreadPage } from "@/lib/api"

const PAGE_SIZE = 30
const TITLE_MAX = 120
const BODY_MAX = 10_000

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

const when = (iso: string) => new Date(iso).toLocaleString()

type Viewer = { readonly token: string; readonly userId: string }

/**
 * Plain text with three conveniences: ```fenced``` code blocks, `inline`
 * code, and http(s) links. Everything goes through React text nodes, so no
 * HTML from a post is ever interpreted.
 */
function PostBody(props: { readonly text: string }) {
  const blocks = props.text.split(/```/)
  return (
    <div className="space-y-2 text-sm">
      {blocks.map((block, i) =>
        i % 2 === 1 ? (
          <pre key={i} className="overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
            {block.replace(/^[a-z+]*\n/i, "").replace(/\n$/, "")}
          </pre>
        ) : block.trim().length === 0 ? null : (
          <p key={i} className="whitespace-pre-wrap break-words">
            <InlineText text={block.replace(/^\n+|\n+$/g, "")} />
          </p>
        )
      )}
    </div>
  )
}

function InlineText(props: { readonly text: string }) {
  const parts = props.text.split(/(`[^`\n]+`)/)
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={i} className="rounded bg-muted px-1 font-mono text-xs">{part.slice(1, -1)}</code>
        ) : (
          <Linked key={i} text={part} />
        )
      )}
    </>
  )
}

function Linked(props: { readonly text: string }) {
  const parts = props.text.split(/(https?:\/\/[^\s<>"')\]]+)/)
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-2">
            {part}
          </a>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  )
}

/**
 * The project's Discussion tab: a list of threads (pinned first, then most
 * recent activity), or one thread with its posts when `threadId` is set.
 * `chunkId` narrows the list to threads about one chunk, and new threads
 * started there point at it.
 */
export function ProjectDiscussion(props: {
  readonly projectSlug: string
  readonly viewer: Viewer | null
  /** Why this viewer cannot post, or null when they can. */
  readonly postBlockedReason: string | null
  readonly canModerate: boolean
  readonly threadId: string | null
  readonly chunkId: string | null
  readonly onOpenThread: (threadId: string | null) => void
  readonly onClearChunk: () => void
  readonly onOpenChunk: (chunkId: string) => void
}) {
  return props.threadId ? (
    <ThreadView {...props} threadId={props.threadId} />
  ) : (
    <ThreadList {...props} />
  )
}

function ThreadList(props: {
  readonly projectSlug: string
  readonly viewer: Viewer | null
  readonly postBlockedReason: string | null
  readonly chunkId: string | null
  readonly onOpenThread: (threadId: string | null) => void
  readonly onClearChunk: () => void
}) {
  const { projectSlug, viewer, chunkId } = props
  const [page, setPage] = React.useState<ThreadPage | null>(null)
  const [offset, setOffset] = React.useState(0)
  const [composing, setComposing] = React.useState(false)
  const [title, setTitle] = React.useState("")
  const [body, setBody] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [chunkName, setChunkName] = React.useState<string | null>(null)

  React.useEffect(() => setOffset(0), [chunkId])

  React.useEffect(() => {
    let cancelled = false
    setPage(null)
    api.listThreads(projectSlug, { chunkId, limit: PAGE_SIZE, offset }).then(
      (next) => { if (!cancelled) setPage(next) },
      (err) => { if (!cancelled) setError(errorText(err, "Could not load the discussion")) }
    )
    return () => { cancelled = true }
  }, [projectSlug, chunkId, offset])

  // The chunk's name, for the filter line and the new-thread form.
  React.useEffect(() => {
    setChunkName(null)
    if (!chunkId) return
    let cancelled = false
    api.getChunk(projectSlug, chunkId).then(
      (chunk) => { if (!cancelled) setChunkName(chunk.name) },
      () => {}
    )
    return () => { cancelled = true }
  }, [projectSlug, chunkId])

  async function start() {
    if (!viewer) return
    setBusy(true)
    setError(null)
    try {
      const created = await api.createThread(
        projectSlug,
        { title: title.trim(), body, ...(chunkId ? { chunkId } : {}) },
        viewer.token
      )
      setTitle("")
      setBody("")
      setComposing(false)
      props.onOpenThread(created.thread.id)
    } catch (err) {
      setError(errorText(err, "Could not start the thread"))
    } finally {
      setBusy(false)
    }
  }

  const total = page?.total ?? 0

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle>Discussion</CardTitle>
            <CardDescription>
              Questions, findings, and plans for this project. Link a thread to a chunk from the chunk's
              Discussion button.
            </CardDescription>
          </div>
          {viewer && props.postBlockedReason === null && !composing ? (
            <Button onClick={() => setComposing(true)}>New thread</Button>
          ) : null}
        </div>
        {chunkId ? (
          <p className="text-sm">
            Threads about <span className="font-mono">{chunkName ?? "this chunk"}</span>.{" "}
            <button type="button" className="underline underline-offset-2" onClick={props.onClearChunk}>
              Show all threads
            </button>
          </p>
        ) : null}
        {!viewer ? (
          <p className="text-sm text-muted-foreground">
            <Link to="/login" className="underline underline-offset-2">Log in</Link> to start a thread or reply.
          </p>
        ) : props.postBlockedReason ? (
          <p className="text-sm text-muted-foreground">{props.postBlockedReason}</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {composing && viewer ? (
          <div className="space-y-2 rounded-md border p-3">
            {chunkId ? (
              <p className="text-xs text-muted-foreground">
                This thread will be about <span className="font-mono">{chunkName ?? "this chunk"}</span>.
              </p>
            ) : null}
            <Input
              placeholder="Title"
              value={title}
              maxLength={TITLE_MAX}
              onChange={(e) => setTitle(e.target.value)}
            />
            <Textarea
              placeholder="What do you want to discuss? Use `backticks` for code and ``` for blocks."
              value={body}
              maxLength={BODY_MAX}
              rows={6}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                disabled={busy || title.trim().length === 0 || body.trim().length === 0}
                onClick={() => void start()}
              >
                Start thread
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setComposing(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

        {page === null ? (
          <p className="text-sm text-muted-foreground">Loading threads…</p>
        ) : page.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {chunkId ? "No threads about this chunk yet." : "No threads yet."}
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {page.items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => props.onOpenThread(t.id)}
                  className="flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-left hover:bg-muted/40"
                >
                  <span className="min-w-0 space-x-2">
                    {t.pinned ? <Badge variant="secondary">pinned</Badge> : null}
                    {t.locked ? <Badge variant="outline">locked</Badge> : null}
                    <span className="font-medium">{t.title}</span>
                    {t.chunkName && !chunkId ? (
                      <span className="font-mono text-xs text-muted-foreground">{t.chunkName}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t.replyCount} {t.replyCount === 1 ? "reply" : "replies"} · {t.lastPostBy ?? "someone"},{" "}
                    {new Date(t.lastPostAt).toLocaleDateString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {total > PAGE_SIZE ? (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">
              {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
            </span>
            <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
              Next
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function ThreadView(props: {
  readonly projectSlug: string
  readonly viewer: Viewer | null
  readonly postBlockedReason: string | null
  readonly canModerate: boolean
  readonly threadId: string
  readonly onOpenThread: (threadId: string | null) => void
  readonly onOpenChunk: (chunkId: string) => void
}) {
  const { projectSlug, viewer, threadId, canModerate } = props
  const [detail, setDetail] = React.useState<ThreadDetail | null>(null)
  const [missing, setMissing] = React.useState(false)
  const [reply, setReply] = React.useState("")
  const [editing, setEditing] = React.useState<{ id: string; body: string } | null>(null)
  const [retitle, setRetitle] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setDetail(null)
    setMissing(false)
    api.getThread(projectSlug, threadId).then(
      (next) => { if (!cancelled) setDetail(next) },
      (err) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) setMissing(true)
        else setError(errorText(err, "Could not load the thread"))
      }
    )
    return () => { cancelled = true }
  }, [projectSlug, threadId])

  async function run(action: () => Promise<ThreadDetail>, failure: string, after?: () => void) {
    setBusy(true)
    setError(null)
    try {
      setDetail(await action())
      after?.()
    } catch (err) {
      setError(errorText(err, failure))
    } finally {
      setBusy(false)
    }
  }

  async function removeThread() {
    if (!viewer || !window.confirm("Remove this thread? It leaves the list for everyone.")) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteThread(projectSlug, threadId, viewer.token)
      props.onOpenThread(null)
    } catch (err) {
      setError(errorText(err, "Could not remove the thread"))
      setBusy(false)
    }
  }

  const back = (
    <button type="button" className="self-start text-left text-sm underline underline-offset-2" onClick={() => props.onOpenThread(null)}>
      ← All threads
    </button>
  )

  if (missing) {
    return (
      <Card>
        <CardContent className="space-y-2 pt-6">
          <p className="text-sm text-muted-foreground">This thread was removed or does not exist.</p>
          {back}
        </CardContent>
      </Card>
    )
  }
  if (detail === null) {
    return error
      ? <p className="text-sm text-destructive">{error}</p>
      : <p className="text-sm text-muted-foreground">Loading thread…</p>
  }

  const { thread, posts } = detail
  const isAuthor = viewer !== null && thread.authorId === viewer.userId
  const canPost = viewer !== null && props.postBlockedReason === null

  return (
    <Card>
      <CardHeader className="space-y-3">
        {back}
        {retitle !== null && viewer ? (
          <div className="flex flex-wrap gap-2">
            <Input value={retitle} maxLength={TITLE_MAX} onChange={(e) => setRetitle(e.target.value)} className="min-w-64 flex-1" />
            <Button
              size="sm"
              disabled={busy || retitle.trim().length === 0}
              onClick={() =>
                void run(
                  () => api.updateThread(projectSlug, threadId, { title: retitle.trim() }, viewer.token),
                  "Could not rename the thread",
                  () => setRetitle(null)
                )
              }
            >
              Save
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRetitle(null)}>Cancel</Button>
          </div>
        ) : (
          <CardTitle className="flex flex-wrap items-center gap-2">
            {thread.title}
            {thread.pinned ? <Badge variant="secondary">pinned</Badge> : null}
            {thread.locked ? <Badge variant="outline">locked</Badge> : null}
          </CardTitle>
        )}
        <CardDescription>
          Started by {thread.authorName ?? "a deleted account"} on {when(thread.createdAt)}
          {thread.chunkId && thread.chunkName ? (
            <>
              {" "}· about{" "}
              <button
                type="button"
                className="font-mono underline underline-offset-2"
                onClick={() => props.onOpenChunk(thread.chunkId!)}
              >
                {thread.chunkName}
              </button>
            </>
          ) : null}
        </CardDescription>
        {viewer && (isAuthor || canModerate) ? (
          <div className="flex flex-wrap gap-2">
            {retitle === null ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setRetitle(thread.title)}>
                Rename
              </Button>
            ) : null}
            {canModerate ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() => api.updateThread(projectSlug, threadId, { pinned: !thread.pinned }, viewer.token), "Could not pin")
                  }
                >
                  {thread.pinned ? "Unpin" : "Pin"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(() => api.updateThread(projectSlug, threadId, { locked: !thread.locked }, viewer.token), "Could not lock")
                  }
                >
                  {thread.locked ? "Unlock" : "Lock"}
                </Button>
              </>
            ) : null}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void removeThread()}>
              Remove thread
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-3">
          {posts.map((post) => (
            <PostItem
              key={post.id}
              projectSlug={projectSlug}
              post={post}
              viewer={viewer}
              canModerate={canModerate}
              locked={thread.locked}
              busy={busy}
              editing={editing?.id === post.id ? editing.body : null}
              onStartEdit={() => setEditing({ id: post.id, body: post.body })}
              onEditChange={(body) => setEditing({ id: post.id, body })}
              onCancelEdit={() => setEditing(null)}
              onSaveEdit={() => {
                if (!viewer || !editing) return
                void run(
                  () => api.editPost(projectSlug, threadId, post.id, editing.body, viewer.token),
                  "Could not save the edit",
                  () => setEditing(null)
                )
              }}
              onRemove={() => {
                if (!viewer || !window.confirm("Remove this post?")) return
                void run(() => api.deletePost(projectSlug, threadId, post.id, viewer.token), "Could not remove the post")
              }}
            />
          ))}
        </ol>

        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

        {thread.locked ? (
          <p className="text-sm text-muted-foreground">This thread is locked. It takes no new replies.</p>
        ) : !viewer ? (
          <p className="text-sm text-muted-foreground">
            <Link to="/login" className="underline underline-offset-2">Log in</Link> to reply.
          </p>
        ) : !canPost ? (
          <p className="text-sm text-muted-foreground">{props.postBlockedReason}</p>
        ) : (
          <div className="space-y-2">
            <Textarea
              placeholder="Reply"
              value={reply}
              maxLength={BODY_MAX}
              rows={4}
              onChange={(e) => setReply(e.target.value)}
            />
            <Button
              disabled={busy || reply.trim().length === 0}
              onClick={() =>
                void run(
                  () => api.replyToThread(projectSlug, threadId, reply, viewer.token),
                  "Could not send the reply",
                  () => setReply("")
                )
              }
            >
              Reply
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function PostItem(props: {
  readonly projectSlug: string
  readonly post: DiscussionPost
  readonly viewer: Viewer | null
  readonly canModerate: boolean
  readonly locked: boolean
  readonly busy: boolean
  readonly editing: string | null
  readonly onStartEdit: () => void
  readonly onEditChange: (body: string) => void
  readonly onCancelEdit: () => void
  readonly onSaveEdit: () => void
  readonly onRemove: () => void
}) {
  const { post, viewer, busy } = props
  const mine = viewer !== null && post.authorId === viewer.userId
  return (
    <li className="space-y-1.5 rounded-md border p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {post.authorId && post.authorName ? (
            <Link to={`/users/${post.authorId}`} className="font-medium text-foreground underline-offset-2 hover:underline">
              {post.authorName}
            </Link>
          ) : (
            <span>a deleted account</span>
          )}{" "}
          · {when(post.createdAt)}
          {post.editedAt && !post.deleted ? <span title={when(post.editedAt)}> · edited</span> : null}
        </p>
        {!post.deleted && props.editing === null && viewer !== null ? (
          <div className="flex gap-2">
            {mine && !props.locked ? (
              <button type="button" className="text-xs underline underline-offset-2" disabled={busy} onClick={props.onStartEdit}>
                Edit
              </button>
            ) : null}
            {mine || props.canModerate ? (
              <button type="button" className="text-xs underline underline-offset-2" disabled={busy} onClick={props.onRemove}>
                Remove
              </button>
            ) : null}
            {!mine ? (
              <ReportButton target={{ projectSlug: props.projectSlug, postId: post.id }} what="this post" variant="text" />
            ) : null}
          </div>
        ) : null}
      </div>
      {post.deleted ? (
        <p className="text-sm italic text-muted-foreground">Post removed.</p>
      ) : props.editing !== null ? (
        <div className="space-y-2">
          <Textarea value={props.editing} maxLength={BODY_MAX} rows={4} onChange={(e) => props.onEditChange(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" disabled={busy || props.editing.trim().length === 0} onClick={props.onSaveEdit}>
              Save
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={props.onCancelEdit}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <PostBody text={post.body} />
      )}
    </li>
  )
}
