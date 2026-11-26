#!/usr/bin/env npx tsx
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { Console, Effect, Layer, Option, Redacted } from "effect"
import { Argument, CliError, Command, Flag, Prompt } from "effect/cli"
import { writeWorkBundle } from "./bundle.js"
import { describeByteDiff, parseByteDiff } from "./byteDiff.js"
import { ApiClient, ApiClientLive } from "./client.js"
import {
  loadConfig,
  readLeaseIndex,
  saveConfig,
  saveLeaseIndex,
  writeLease
} from "./config.js"
import {
  checkoutChunk,
  checkoutLines,
  ExitCode,
  explainFailure,
  hexAddress,
  HydraExit,
  leaseGone,
  resolveChunkId,
  untilText
} from "./work.js"
import { importExport, integrate, types } from "./projectCommands.js"
import { skill } from "./skillCommands.js"
import { currentLease, currentUrl, ensureUrl, hydra, say } from "./root.js"


const login = Command.make(
  "login",
  {
    email: Flag.String("email").pipe(
      Flag.withDescription("Account email"),
      Flag.optional
    ),
    password: Flag.String("password").pipe(
      Flag.withDescription("Account password"),
      Flag.optional
    ),
    token: Flag.String("token").pipe(
      Flag.withDescription("Profile access token"),
      Flag.optional
    )
  },
  Effect.fn(function*({ email, password, token }) {
    yield* ensureUrl
    const client = yield* ApiClient
    const root = yield* hydra

    if (Option.isSome(token)) {
      yield* saveConfig({ baseUrl: yield* currentUrl, token: token.value, kind: "token" })
      yield* say({ ok: true }, ["Token saved."])
      return
    }

    // Without a terminal (an agent, a script) a prompt would hang or read nothing.
    if ((Option.isNone(email) || Option.isNone(password)) && !process.stdin.isTTY) {
      return yield* new HydraExit({
        code: ExitCode.notSignedIn,
        message: "No terminal to prompt in. Use hydra login --token <token> (create one on your profile page), " +
          "or pass both --email and --password."
      })
    }

    const accountEmail = Option.isSome(email)
      ? email.value
      : yield* Prompt.run(Prompt.String({ message: "Email" }))
    const accountPassword = Option.isSome(password)
      ? password.value
      : Redacted.value(yield* Prompt.run(Prompt.Password({ message: "Password" })))

    const session = yield* client.auth.signIn({
      payload: { email: accountEmail.trim(), password: accountPassword }
    })
    yield* saveConfig({ baseUrl: yield* currentUrl, token: session.token, kind: "session" })
    yield* say(session, [`Logged in as ${session.user.email}`])
  })
).pipe(Command.withDescription("Sign in with email and password"))

const logout = Command.make(
  "logout",
  {},
  Effect.fn(function*() {
    yield* ensureUrl
    const client = yield* ApiClient
    const config = yield* loadConfig
    if (config.kind === "token") {
      yield* saveConfig({ baseUrl: config.baseUrl })
      yield* say(
        { ok: true, revoked: false },
        ["Forgot the token on this machine. It still works until you revoke it on your profile."]
      )
      return
    }
    if (config.token !== undefined) {
      yield* client.auth.logout({}).pipe(Effect.ignore)
    }
    yield* saveConfig({ baseUrl: config.baseUrl })
    yield* say({ ok: true, revoked: true }, ["Logged out."])
  })
).pipe(
  Command.withDescription(
    "Forget the saved login. A session is revoked. A profile token stays valid until you revoke it."
  )
)

const me = Command.make(
  "me",
  {},
  Effect.fn(function*() {
    yield* ensureUrl
    const client = yield* ApiClient
    const site = yield* currentUrl
    const user = yield* client.auth.me({})
    yield* say({ ...user, site }, [`${user.displayName} <${user.email}> (${user.id})`, `  site: ${site}`])
  })
).pipe(Command.withDescription("Show the current user and the site the CLI talks to"))

const list = Command.make(
  "list",
  {
    project: Argument.String("project").pipe(
      Argument.withDescription("Project slug")
    ),
    state: Flag.Literals("state", [
      "open",
      "leased",
      "validating",
      "matched",
      "stale",
      "blocked"
    ]).pipe(
      Flag.optional,
      Flag.withDescription("Chunk state")
    ),
    query: Flag.String("query").pipe(
      Flag.optional,
      Flag.withDescription("Match chunk name or address")
    ),
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("Page size. Default 100. Maximum 500."),
      Flag.withDefault(100)
    ),
    page: Flag.Int("page").pipe(
      Flag.withDescription("Page number, starting at 1."),
      Flag.withDefault(1)
    )
  },
  Effect.fn(function*({ project, state, query, limit, page }) {
    if (page < 1) {
      return yield* Effect.fail(new Error("--page starts at 1."))
    }
    if (limit < 1 || limit > 500) {
      return yield* Effect.fail(new Error("--limit must be from 1 to 500."))
    }
    yield* ensureUrl
    const client = yield* ApiClient
    const q = Option.isSome(query) ? query.value.trim() : ""
    const chunks = yield* client.chunks.list({
      params: { projectSlug: project },
      query: {
        limit,
        offset: (page - 1) * limit,
        ...(Option.isSome(state) ? { state: state.value } : {}),
        ...(q.length > 0 ? { q } : {})
      }
    })
    const root = yield* hydra
    if (root.json) {
      yield* Console.log(JSON.stringify(chunks))
      return
    }
    if (chunks.length === 0) {
      yield* Console.log(page === 1 ? "No chunks." : `No chunks on page ${page}.`)
      return
    }
    for (const chunk of chunks) {
      yield* Console.log(
        `${chunk.id}  ${chunk.state.padEnd(10)}  ${hexAddress(chunk.address).padEnd(10)}  ${chunk.name}`
      )
    }
    const more = chunks.length === limit ? ` More: --page ${page + 1}` : ""
    yield* Console.log(`Page ${page} (${chunks.length}).${more}`)
  })
).pipe(Command.withDescription("List one page of chunks"))

const checkout = Command.make(
  "checkout",
  {
    project: Argument.String("project").pipe(
      Argument.withDescription("Project slug")
    ),
    chunk: Argument.String("chunk").pipe(
      Argument.withDescription("Chunk id, exact name, or address (0x401000)")
    ),
    out: Flag.String("out").pipe(
      Flag.withDescription("Work directory (default: ./chunks/<project>/<name>)"),
      Flag.optional
    )
  },
  Effect.fn(function*({ project, chunk, out }) {
    yield* ensureUrl
    const chunkId = yield* resolveChunkId(project, chunk)
    const { lease, dir } = yield* checkoutChunk(project, chunkId, out)
    yield* say({ ...lease, workDir: dir }, checkoutLines(lease, dir))
  })
).pipe(Command.withDescription("Claim a chunk and write a work bundle"))

const next = Command.make(
  "next",
  {
    project: Argument.String("project").pipe(
      Argument.withDescription("Project slug")
    ),
    query: Flag.String("query").pipe(
      Flag.optional,
      Flag.withDescription("Only chunks whose name or address matches")
    ),
    smallest: Flag.Boolean("smallest").pipe(
      Flag.withDescription("Take the smallest open chunk (of the first 500) instead of the first"),
      Flag.withDefault(false)
    ),
    out: Flag.String("out").pipe(
      Flag.withDescription("Work directory (default: ./chunks/<project>/<name>)"),
      Flag.optional
    )
  },
  Effect.fn(function*({ project, query, smallest, out }) {
    yield* ensureUrl
    const client = yield* ApiClient
    const q = Option.isSome(query) ? query.value.trim() : ""
    const open = yield* client.chunks.list({
      params: { projectSlug: project },
      query: { state: "open", limit: smallest ? 500 : 20, ...(q.length > 0 ? { q } : {}) }
    })
    const order = smallest ? [...open].sort((a, b) => a.size - b.size) : open
    // Someone else may take a chunk between the list and the checkout; try a few.
    for (const candidate of order.slice(0, 5)) {
      const taken = yield* checkoutChunk(project, candidate.id, out).pipe(
        Effect.map(Option.some),
        // Taken between the list and the checkout, or otherwise refused: try the next.
        Effect.catchTag("ChunkRefused", () => Effect.succeedNone)
      )
      if (Option.isSome(taken)) {
        const { lease, dir } = taken.value
        yield* say({ ...lease, workDir: dir }, checkoutLines(lease, dir))
        return
      }
    }
    return yield* new HydraExit({
      code: ExitCode.nothingOpen,
      message: order.length === 0
        ? `No open chunks in ${project}${q.length > 0 ? ` matching "${q}"` : ""}.`
        : `The open chunks tried in ${project} were taken first. Run hydra next again.`
    })
  })
).pipe(Command.withDescription("Check out the next open chunk"))

const submit = Command.make(
  "submit",
  {
    source: Argument.String("source").pipe(
      Argument.withDescription(
        "Source file (default: candidate.c near .lease.json)"
      ),
      Argument.optional
    ),
    wait: Flag.Int("wait").pipe(
      Flag.withDescription("Seconds to wait for the result. Default 60; 0 returns at once."),
      Flag.withDefault(60)
    )
  },
  Effect.fn(function*({ source, wait }) {
    if (wait < 0) {
      return yield* Effect.fail(new Error("--wait cannot be negative."))
    }
    yield* ensureUrl
    const lease = yield* currentLease
    const sourcePath = Option.isSome(source)
      ? path.resolve(source.value)
      : path.join(lease.workDir, "candidate.c")

    const text = yield* Effect.try({
      try: () => readFileSync(sourcePath, "utf8"),
      catch: (cause) =>
        new Error(`Could not read ${sourcePath}: ${String(cause)}`)
    })

    const root = yield* hydra
    if (!root.json) {
      yield* Console.log("Submitted source is released under CC0 1.0 (content policy 2.4).")
    }
    const client = yield* ApiClient
    const result = yield* leaseGone(client.chunks.submit({
      params: {
        projectSlug: lease.projectSlug,
        chunkId: lease.chunkId
      },
      payload: {
        leaseToken: lease.leaseToken,
        source: text
      }
    }))

    let current = result
    if (current.state !== "finished" && wait > 0) {
      if (!root.json) {
        yield* Console.log("Matching…")
      }
      for (let i = 0; i < wait; i++) {
        yield* Effect.sleep("1 second")
        const attempts = yield* client.chunks.listAttempts({
          params: {
            projectSlug: lease.projectSlug,
            chunkId: lease.chunkId
          }
        })
        const row = attempts.find((item) => item.id === current.attemptId)
        if (row?.finishedAt) {
          current = {
            ...current,
            state: "finished",
            score: row.score,
            matched: row.matched,
            diagnostics: row.diagnostics
          }
          break
        }
      }
    }

    const lines = [
      `Submitted ${path.basename(sourcePath)}`,
      `  attempt:  ${current.attemptId}`,
      `  job:      ${current.jobId}`,
      `  state:    ${current.state}`
    ]
    if (current.score !== null) lines.push(`  score:    ${current.score}`)
    if (current.matched !== null) lines.push(`  matched:  ${current.matched}`)
    const diff = current.matched === false ? parseByteDiff(current.diagnostics) : undefined
    if (diff !== undefined) {
      // The summary first; the full dump stays in hydra attempts and --json.
      lines.push(...describeByteDiff(diff))
      // The bytes can agree and the attempt still miss: a call to the wrong function.
      const reason = current.diagnostics?.split("\n").find((line) => line.startsWith("not a match:"))
      if (reason !== undefined) lines.push(`  ${reason}`)
    } else if (current.diagnostics !== null && current.diagnostics.length > 0) {
      lines.push("--- diagnostics ---", current.diagnostics)
    }
    if (current.state !== "finished") {
      lines.push("Still checking. See the result with: hydra attempts")
    }
    yield* say(diff === undefined ? current : { ...current, byteDiff: diff }, lines)
    if (current.state !== "finished") {
      return yield* new HydraExit({ code: ExitCode.stillChecking, message: "" })
    }
    if (current.matched !== true) {
      return yield* new HydraExit({ code: ExitCode.notMatched, message: "" })
    }
  })
).pipe(Command.withDescription("Submit source for the current lease and wait for the result"))

const release = Command.make(
  "release",
  {},
  Effect.fn(function*() {
    yield* ensureUrl
    const lease = yield* currentLease
    const client = yield* ApiClient
    const chunk = yield* leaseGone(client.chunks.release({
      params: {
        projectSlug: lease.projectSlug,
        chunkId: lease.chunkId
      },
      payload: { leaseToken: lease.leaseToken }
    }))
    yield* say(chunk, [`Released ${chunk.name} (${chunk.state})`])
  })
).pipe(Command.withDescription("Release the current lease"))

const heartbeat = Command.make(
  "heartbeat",
  {},
  Effect.fn(function*() {
    yield* ensureUrl
    const lease = yield* currentLease
    const client = yield* ApiClient
    const next = yield* leaseGone(client.chunks.heartbeat({
      params: {
        projectSlug: lease.projectSlug,
        chunkId: lease.chunkId
      },
      payload: { leaseToken: lease.leaseToken }
    }))
    yield* writeLease({
      ...lease,
      leaseExpiresAt: next.leaseExpiresAt
    })
    yield* say(next, [`Lease extended to ${next.leaseExpiresAt}`])
  })
).pipe(Command.withDescription("Extend the current lease"))

const attempts = Command.make(
  "attempts",
  {
    project: Argument.String("project").pipe(
      Argument.optional,
      Argument.withDescription("Project slug. Omitted inside a checkout.")
    ),
    chunk: Argument.String("chunk").pipe(
      Argument.optional,
      Argument.withDescription("Chunk id, name, or address. Omitted inside a checkout.")
    )
  },
  Effect.fn(function*({ project, chunk }) {
    yield* ensureUrl
    const located = Option.isSome(project) && Option.isSome(chunk)
      ? { projectSlug: project.value, chunkId: yield* resolveChunkId(project.value, chunk.value) }
      : Option.isNone(project) && Option.isNone(chunk)
        ? yield* currentLease
        : yield* Effect.fail(
            new Error("Pass both the project slug and the chunk id, or run this inside a checkout.")
          )
    const client = yield* ApiClient
    const rows = yield* client.chunks.listAttempts({
      params: {
        projectSlug: located.projectSlug,
        chunkId: located.chunkId
      }
    })
    const root = yield* hydra
    if (root.json) {
      yield* Console.log(JSON.stringify(rows))
      return
    }
    if (rows.length === 0) {
      yield* Console.log("No attempts.")
      return
    }
    for (const row of rows) {
      const status = row.matched === true ? "matched" : row.matched === false ? "miss" : "pending"
      const score = row.score === null ? "" : `  ${row.score}`
      yield* Console.log(
        `${row.createdAt}  ${status.padEnd(8)}  ${row.displayName ?? "deleted account"}${score}`
      )
      const detail = row.diagnostics?.split("\n")[0]
      if (detail !== undefined && detail.length > 0) {
        yield* Console.log(`  ${detail}`)
      }
    }
  })
).pipe(Command.withDescription("Show attempt history for a chunk"))

const watch = Command.make(
  "watch",
  {
    interval: Flag.Int("interval").pipe(
      Flag.withDescription("Seconds between heartbeats. Default 300."),
      Flag.withDefault(300)
    )
  },
  Effect.fn(function*({ interval }) {
    if (interval < 15) {
      return yield* Effect.fail(new Error("--interval must be at least 15 seconds."))
    }
    yield* ensureUrl
    const beat = Effect.gen(function*() {
      const lease = yield* currentLease
      const client = yield* ApiClient
      const next = yield* leaseGone(client.chunks.heartbeat({
        params: {
          projectSlug: lease.projectSlug,
          chunkId: lease.chunkId
        },
        payload: { leaseToken: lease.leaseToken }
      }))
      yield* writeLease({
        ...lease,
        leaseExpiresAt: next.leaseExpiresAt
      })
      yield* say(next, [`Lease extended to ${next.leaseExpiresAt}`])
    })
    yield* beat
    return yield* Effect.forever(
      Effect.gen(function*() {
        yield* Effect.sleep(`${interval} seconds`)
        yield* beat
      })
    )
  })
).pipe(Command.withDescription("Heartbeat the current checkout until Ctrl+C"))

const members = Command.make(
  "members",
  {
    project: Argument.String("project").pipe(
      Argument.withDescription("Project slug")
    )
  },
  Effect.fn(function*({ project }) {
    yield* ensureUrl
    const client = yield* ApiClient
    const rows = yield* client.projects.listMembers({ params: { projectSlug: project } })
    yield* say(
      rows,
      rows.map((m) => `${m.role.padEnd(11)}  ${m.displayName}  (${m.userId})`)
    )
  })
).pipe(Command.withDescription("List a project's members and their roles"))

const status = Command.make(
  "status",
  {},
  Effect.fn(function*() {
    yield* ensureUrl
    const client = yield* ApiClient
    const work = yield* client.users.myWork({})
    const index = yield* readLeaseIndex
    // Keep only the folders of leases the server still lists.
    const live = new Set(work.leases.map((lease) => lease.leaseToken))
    const kept = index.filter((entry) => live.has(entry.leaseToken))
    if (kept.length !== index.length) yield* saveLeaseIndex(kept)
    const dirOf = (token: string) => kept.find((entry) => entry.leaseToken === token)?.workDir ?? null

    const leases = work.leases.map((lease) => ({ ...lease, workDir: dirOf(lease.leaseToken) }))
    const lines: Array<string> = []
    if (leases.length === 0) {
      lines.push("No chunks checked out. Take one with: hydra next <project>")
    } else {
      lines.push(`Checked out (${leases.length}):`)
      for (const lease of leases) {
        const competing = lease.kind === "competing" ? "  (competing)" : ""
        lines.push(
          `  ${lease.projectSlug}  ${hexAddress(lease.address)}  ${lease.chunkName}  expires ${untilText(lease.leaseExpiresAt)}${competing}`,
          `    ${lease.workDir ?? "folder unknown: checked out on another machine or before this version"}`
        )
      }
    }
    if (work.checking.length > 0) {
      lines.push(`Being checked (${work.checking.length}):`)
      for (const attempt of work.checking) lines.push(`  ${attempt.projectSlug}  ${attempt.chunkName}`)
    }
    const recent = work.recent.slice(0, 5)
    if (recent.length > 0) {
      lines.push("Recent attempts:")
      for (const attempt of recent) {
        const score = attempt.score === null ? "" : `  ${attempt.score}`
        lines.push(`  ${attempt.result.padEnd(13)}  ${attempt.projectSlug}  ${attempt.chunkName}${score}`)
      }
    }
    yield* say({ ...work, leases }, lines)
  })
).pipe(Command.withDescription("Your checked-out chunks, with folders and expiry, and recent attempts"))

const show = Command.make(
  "show",
  {
    project: Argument.String("project").pipe(
      Argument.optional,
      Argument.withDescription("Project slug. Omitted inside a checkout.")
    ),
    chunk: Argument.String("chunk").pipe(
      Argument.optional,
      Argument.withDescription("Chunk id, name, or address. Omitted inside a checkout.")
    )
  },
  Effect.fn(function*({ project, chunk }) {
    yield* ensureUrl
    const located = Option.isSome(project) && Option.isSome(chunk)
      ? { projectSlug: project.value, chunkId: yield* resolveChunkId(project.value, chunk.value) }
      : Option.isNone(project) && Option.isNone(chunk)
        ? yield* currentLease
        : yield* Effect.fail(
            new Error("Pass both the project slug and the chunk, or run this inside a checkout.")
          )
    const client = yield* ApiClient
    const params = { projectSlug: located.projectSlug, chunkId: located.chunkId }
    const summary = yield* client.chunks.get({ params })
    const attemptRows = yield* client.chunks.listAttempts({ params })
    const best = attemptRows.find((row) => row.best)
    const matched = attemptRows.filter((row) => row.matched === true).length

    const lines = [
      `${summary.name}  ${hexAddress(summary.address)}  ${summary.size} bytes`,
      `  state:     ${summary.state}`
    ]
    if (summary.leaseExpiresAt !== undefined) {
      lines.push(`  lease:     held, expires ${untilText(summary.leaseExpiresAt)}`)
    }
    if (summary.languageOverride !== undefined) lines.push(`  language:  ${summary.languageOverride}`)
    if (summary.allowInlineAsm) lines.push("  inline asm allowed")
    lines.push(`  attempts:  ${attemptRows.length}${matched > 0 ? ` (${matched} matched)` : ""}`)
    if (best !== undefined) {
      const result = best.matched === true ? "matched" : best.score === null ? "pending" : `score ${best.score}`
      lines.push(`  best:      ${result} by ${best.displayName ?? "a deleted account"}`)
    }
    lines.push(`  id:        ${summary.id}`)
    yield* say({ ...summary, attempts: attemptRows.length, matchedAttempts: matched, best: best ?? null }, lines)
  })
).pipe(Command.withDescription("Show one chunk's state, holder, and best attempt"))

const refresh = Command.make(
  "refresh",
  {},
  Effect.fn(function*() {
    yield* ensureUrl
    const lease = yield* currentLease
    const client = yield* ApiClient
    const bundle = yield* leaseGone(client.chunks.bundle({
      params: { projectSlug: lease.projectSlug, chunkId: lease.chunkId }
    }))
    yield* writeWorkBundle(lease.workDir, bundle, { keepCandidate: true })
    yield* say(bundle.meta, [
      `Refreshed the work bundle for ${lease.chunkName} in ${lease.workDir}`,
      "  candidate.c was kept. types.h, neighbors.json, and attempt.c are current."
    ])
  })
).pipe(Command.withDescription("Download the work bundle again (new types, neighbors, best attempt); keeps candidate.c"))

const MainLive = Layer.mergeAll(ApiClientLive, NodeServices.layer)

hydra.pipe(
  Command.withSubcommands([
    login,
    logout,
    me,
    list,
    checkout,
    submit,
    release,
    heartbeat,
    attempts,
    members,
    watch,
    next,
    status,
    show,
    refresh,
    types,
    importExport,
    integrate,
    skill
  ]),
  Command.run({ version: "0.0.0" }),
  // One plain line on stderr and a meaningful exit code, instead of a stack.
  // Usage errors stay with the CLI library, which prints help.
  // The code is set on process.exitCode rather than failing: runMain calls
  // process.exit for a failure, which on Windows can abort Node while piped
  // output (hydra --json submit | jq) is still being written.
  Effect.catch((error): Effect.Effect<void, CliError.CliError> =>
    CliError.isCliError(error)
      ? Effect.fail(error)
      : Effect.gen(function*() {
        const config = yield* loadConfig
        const explained = explainFailure(error, config.baseUrl)
        if (explained.message.length > 0) yield* Console.error(explained.message)
        process.exitCode = explained.code
      })
  ),
  Effect.provide(MainLive),
  NodeRuntime.runMain
)
