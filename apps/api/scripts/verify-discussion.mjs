// End-to-end checks for project discussion (threads and posts).
//
// Needs an API with RATE_LIMITS=off on a throwaway seeded database.
//
//   AUDIT_API=http://localhost:3100/v1 node apps/api/scripts/verify-discussion.mjs
import { randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const API = process.env.AUDIT_API ?? "http://localhost:3100/v1"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")
const sample = JSON.parse(readFileSync(path.join(root, "fixtures/sample/export.json"), "utf8"))

const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`)
}
const call = async (method, p, token, body) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  })
  const text = await res.text()
  let json
  try { json = JSON.parse(text) } catch { json = text }
  return { status: res.status, body: json }
}
const ok = (s) => s >= 200 && s < 300
const detail = (r) => `${r.status}${r.body?.detail ? `: ${r.body.detail}` : ""}`
const signUp = async (label) => {
  const name = `Disc ${label} ${randomBytes(2).toString("hex")}`
  const res = await call("POST", "/auth/sign-up", undefined, {
    email: `audit-disc-${label}-${randomBytes(3).toString("hex")}@example.test`, displayName: name, password: randomBytes(18).toString("base64url")
  })
  if (!ok(res.status)) throw new Error(`sign-up failed: ${res.status}`)
  return { token: res.body.token, id: res.body.user.id, name }
}

const owner = (await call("POST", "/auth/sign-in", undefined, { email: "dev@re-hydra.local", password: "rehydra-dev" })).body.token
const m = await signUp("maintainer")
const a = await signUp("author")
const b = await signUp("replier")
const x = await signUp("blocked")
const slug = `disc-${randomBytes(3).toString("hex")}`
const created = await call("POST", "/projects", owner, {
  slug, name: "Discussion check", homeRegion: "us-east-1", language: "c",
  toolchain: { compiler: "gcc", version: "4.8.5", flags: ["-O2"], image: "ghcr.io/re-hydra/gcc:4.8.5@sha256:dev" }
})
if (created.status !== 201) throw new Error(`project create failed: ${detail(created)}`)
await call("POST", `/projects/${slug}/imports`, owner, sample)
const chunk = (await call("GET", `/projects/${slug}/chunks`)).body[0]
const P = `/projects/${slug}`
await call("POST", `${P}/members`, owner, { userId: m.id, role: "maintainer" })

// --- Starting threads.
const anon = await call("POST", `${P}/threads`, undefined, { title: "t", body: "b" })
check("starting a thread needs a signed-in user", anon.status === 401, detail(anon))
const blank = await call("POST", `${P}/threads`, a.token, { title: "Hello", body: "   " })
check("an empty message is refused", blank.status === 409 && /Write something/.test(blank.body?.detail ?? ""), detail(blank))
const longTitle = await call("POST", `${P}/threads`, a.token, { title: "x".repeat(121), body: "b" })
check("titles are capped at 120 characters", longTitle.status === 400, detail(longTitle))
const t1 = await call("POST", `${P}/threads`, a.token, { title: "  Calling convention in parse_header  ", body: "It looks like __stdcall to me." })
check("anyone who may work here starts a thread, trimmed",
  t1.status === 201 && t1.body.thread.title === "Calling convention in parse_header" && t1.body.posts.length === 1 && t1.body.thread.replyCount === 0, detail(t1))
const T1 = `${P}/threads/${t1.body.thread.id}`
const t2 = await call("POST", `${P}/threads`, b.token, { title: "About this chunk", body: "Needs struct header.", chunkId: chunk.id })
check("a thread can point at a chunk", t2.status === 201 && t2.body.thread.chunkId === chunk.id && t2.body.thread.chunkName === chunk.name, detail(t2))
const foreign = await call("POST", `${P}/threads`, b.token, { title: "Wrong", body: "x", chunkId: a.id })
check("a chunk from elsewhere is refused", foreign.status === 409, detail(foreign))

// --- Reading.
const list = (await call("GET", `${P}/threads`)).body
check("anyone can list threads, newest activity first", list.total === 2 && list.items[0].id === t2.body.thread.id, `${list.total}`)
const byChunk = (await call("GET", `${P}/threads?chunkId=${chunk.id}`)).body
check("threads filter by chunk", byChunk.total === 1 && byChunk.items[0].id === t2.body.thread.id, `${byChunk.total}`)
const paged = (await call("GET", `${P}/threads?limit=1&offset=1`)).body
check("threads page with limit and offset", paged.items.length === 1 && paged.total === 2 && paged.items[0].id === t1.body.thread.id)
const feed = (await call("GET", `${P}/activity`)).body.map((e) => e.summary)
check("starting a thread reaches the feed", feed.includes(`${a.name} started a thread: Calling convention in parse_header`))

// --- Replies, edits, removal.
const r1 = await call("POST", `${T1}/posts`, b.token, { body: "Agreed, the callee pops." })
const afterReply = (await call("GET", `${P}/threads`)).body
check("a reply adds a post and bumps the thread",
  r1.status === 201 && r1.body.posts.length === 2 && r1.body.thread.replyCount === 1 && r1.body.thread.lastPostBy === b.name &&
    afterReply.items[0].id === t1.body.thread.id, detail(r1))
const feedAfter = (await call("GET", `${P}/activity`)).body.map((e) => e.summary)
check("replies stay off the feed", !feedAfter.some((s) => /callee pops|replied/i.test(s)))
const replyId = r1.body.posts[1].id
const editByOther = await call("PATCH", `${T1}/posts/${replyId}`, a.token, { body: "hijack" })
check("only the author edits a post", editByOther.status === 403, detail(editByOther))
const edited = await call("PATCH", `${T1}/posts/${replyId}`, b.token, { body: "Agreed: callee pops the args." })
check("the author edits, and it is marked edited",
  ok(edited.status) && edited.body.posts[1].body === "Agreed: callee pops the args." && edited.body.posts[1].editedAt !== null, detail(edited))
const delByOther = await call("DELETE", `${T1}/posts/${replyId}`, a.token)
check("a non-author non-manager cannot remove a post", delByOther.status === 403, detail(delByOther))
const delByManager = await call("DELETE", `${T1}/posts/${replyId}`, m.token)
check("a maintainer removes a post; its place stays, its text goes",
  ok(delByManager.status) && delByManager.body.posts.length === 2 && delByManager.body.posts[1].deleted === true && delByManager.body.posts[1].body === "", detail(delByManager))
const editRemoved = await call("PATCH", `${T1}/posts/${replyId}`, b.token, { body: "back" })
check("a removed post cannot be edited", editRemoved.status === 404, detail(editRemoved))

// --- Pin, lock, retitle.
const pinByAuthor = await call("PATCH", T1, a.token, { pinned: true })
check("only owners and maintainers pin", pinByAuthor.status === 403, detail(pinByAuthor))
const retitle = await call("PATCH", T1, a.token, { title: "Calling convention: stdcall" })
check("the author retitles their thread", ok(retitle.status) && retitle.body.thread.title === "Calling convention: stdcall", detail(retitle))
await call("PATCH", T1, m.token, { pinned: true, locked: true })
const pinnedList = (await call("GET", `${P}/threads`)).body
check("a pinned thread lists first", pinnedList.items[0].id === t1.body.thread.id && pinnedList.items[0].pinned && pinnedList.items[0].locked)
const lockedReply = await call("POST", `${T1}/posts`, b.token, { body: "one more" })
check("a locked thread takes no replies", lockedReply.status === 409 && /locked/.test(lockedReply.body?.detail ?? ""), detail(lockedReply))
await call("PATCH", T1, owner, { locked: false })
const unlockedReply = await call("POST", `${T1}/posts`, b.token, { body: "one more" })
check("unlocking reopens replies", unlockedReply.status === 201, detail(unlockedReply))

// --- Access: blocked users and members-only projects.
await call("POST", `${P}/blocks`, owner, { userId: x.id })
const blockedPost = await call("POST", `${T1}/posts`, x.token, { body: "hi" })
check("a blocked user cannot post", blockedPost.status === 403, detail(blockedPost))
await call("PATCH", `${P}/settings`, owner, { checkoutPolicy: "members" })
const outsider = await call("POST", `${P}/threads`, b.token, { title: "Still here?", body: "x" })
const memberPost = await call("POST", `${T1}/posts`, m.token, { body: "Members can still post." })
const outsiderRead = await call("GET", T1)
check("members-only: non-members cannot post, members can, anyone reads",
  outsider.status === 403 && memberPost.status === 201 && ok(outsiderRead.status), `${outsider.status}/${memberPost.status}/${outsiderRead.status}`)
await call("PATCH", `${P}/settings`, owner, { checkoutPolicy: "open" })

// --- Removing threads.
const t3 = await call("POST", `${P}/threads`, a.token, { title: "Typo thread", body: "oops" })
const delThreadByOther = await call("DELETE", `${P}/threads/${t3.body.thread.id}`, b.token)
check("a non-author non-manager cannot remove a thread", delThreadByOther.status === 403, detail(delThreadByOther))
const delThread = await call("DELETE", `${P}/threads/${t3.body.thread.id}`, a.token)
const gone = await call("GET", `${P}/threads/${t3.body.thread.id}`)
const finalList = (await call("GET", `${P}/threads`)).body
check("the author removes their thread; it leaves the list",
  ok(delThread.status) && gone.status === 404 && !finalList.items.some((t) => t.id === t3.body.thread.id), `${delThread.status}/${gone.status}`)
const wrongProject = await call("GET", `/projects/sample/threads/${t1.body.thread.id}`)
check("a thread id from another project is not found", wrongProject.status === 404, detail(wrongProject))

const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed === 0 ? 0 : 1)
