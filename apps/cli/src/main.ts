#!/usr/bin/env npx tsx
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { Console, Effect, Layer, Option, Redacted } from "effect"
import { Argument, Command, Flag, Prompt } from "effect/cli"
import { writeWorkBundle, workDirFor } from "./bundle.js"
import { ApiClient, ApiClientLive } from "./client.js"
import {
  defaultBaseUrl,
  loadConfig,
  readLeaseNear,
  saveConfig,
  writeLease
} from "./config.js"

const hydra = Command.make("hydra").pipe(
  Command.withSharedFlags({
    url: Flag.String("url").pipe(
      Flag.withDescription("API base URL"),
      Flag.withDefault(defaultBaseUrl)
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print API JSON"),
      Flag.withDefault(false)
    )
  }),
  Command.withDescription("re-hydra contributor CLI")
)

const say = (value: unknown, lines: ReadonlyArray<string>) =>
  Effect.gen(function*() {
    const root = yield* hydra
    if (root.json) {
      yield* Console.log(JSON.stringify(value))
      return
    }
    for (const line of lines) {
      yield* Console.log(line)
    }
  })

const ensureUrl = Effect.gen(function*() {
  const root = yield* hydra
  const config = yield* loadConfig
  if (config.baseUrl !== root.url) {
    yield* saveConfig({
      ...config,
      baseUrl: root.url
    })
  }
})

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
      yield* saveConfig({ baseUrl: root.url, token: token.value, kind: "token" })
      yield* say({ ok: true }, ["Token saved."])
      return
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
    yield* saveConfig({ baseUrl: root.url, token: session.token, kind: "session" })
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
    const user = yield* client.auth.me({})
    yield* say(user, [`${user.displayName} <${user.email}> (${user.id})`])
  })
).pipe(Command.withDescription("Show the current user"))

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
        `${chunk.id}  ${chunk.state.padEnd(10)}  ${chunk.address}  ${chunk.name}`
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
      Argument.withDescription("Chunk UUID")
    ),
    out: Flag.String("out").pipe(
      Flag.withDescription("Work directory (default: ./chunks/<project>/<name>)"),
      Flag.optional
    )
  },
  Effect.fn(function*({ project, chunk, out }) {
    yield* ensureUrl
    const client = yield* ApiClient
    const lease = yield* client.chunks.checkout({
      params: { projectSlug: project, chunkId: chunk }
    })

    const dir = Option.isSome(out)
      ? path.resolve(out.value)
      : workDirFor(project, lease.chunk.name)

    yield* writeWorkBundle(dir, lease.bundle)
    yield* writeLease({
      projectSlug: project,
      chunkId: lease.chunk.id,
      chunkName: lease.chunk.name,
      leaseToken: lease.leaseToken,
      leaseExpiresAt: lease.leaseExpiresAt,
      workDir: dir
    })

    yield* say(lease, [
      `Checked out ${lease.chunk.name}`,
      `  workdir:  ${dir}`,
      `  lease:    ${lease.leaseToken}`,
      `  expires:  ${lease.leaseExpiresAt}`,
      `  agent:    ${path.join(dir, "instructions.agent")}`,
      ...(lease.bundle.integrationNote !== undefined
        ? [`  link:     ${path.join(dir, "integration.txt")}`]
        : []),
      `  edit:     ${path.join(dir, "candidate.c")}`,
      "  submit:   hydra submit"
    ])
  })
).pipe(Command.withDescription("Claim a chunk and write a work bundle"))

const submit = Command.make(
  "submit",
  {
    source: Argument.String("source").pipe(
      Argument.withDescription(
        "Source file (default: candidate.c near .lease.json)"
      ),
      Argument.optional
    )
  },
  Effect.fn(function*({ source }) {
    yield* ensureUrl
    const lease = yield* readLeaseNear(process.cwd())
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
    const result = yield* client.chunks.submit({
      params: {
        projectSlug: lease.projectSlug,
        chunkId: lease.chunkId
      },
      payload: {
        leaseToken: lease.leaseToken,
        source: text
      }
    })

    let current = result
    if (current.state !== "finished") {
      if (!root.json) {
        yield* Console.log("Matching…")
      }
      for (let i = 0; i < 30; i++) {
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
    if (current.diagnostics !== null && current.diagnostics.length > 0) {
      lines.push("--- diagnostics ---", current.diagnostics)
    } else if (current.state !== "finished") {
      lines.push("Match is still running. Check the chunk page for the result.")
    }
    yield* say(current, lines)
  })
).pipe(Command.withDescription("Submit source for the current lease"))

const release = Command.make(
  "release",
  {},
  Effect.fn(function*() {
    yield* ensureUrl
    const lease = yield* readLeaseNear(process.cwd())
    const client = yield* ApiClient
    const chunk = yield* client.chunks.release({
      params: {
        projectSlug: lease.projectSlug,
        chunkId: lease.chunkId
      },
      payload: { leaseToken: lease.leaseToken }
    })
    yield* say(chunk, [`Released ${chunk.name} (${chunk.state})`])
  })
).pipe(Command.withDescription("Release the current lease"))

const heartbeat = Command.make(
  "heartbeat",
  {},
  Effect.fn(function*() {
    yield* ensureUrl
    const lease = yield* readLeaseNear(process.cwd())
    const client = yield* ApiClient
    const next = yield* client.chunks.heartbeat({
      params: {
        projectSlug: lease.projectSlug,
        chunkId: lease.chunkId
      },
      payload: { leaseToken: lease.leaseToken }
    })
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
      Argument.withDescription("Chunk id. Omitted inside a checkout.")
    )
  },
  Effect.fn(function*({ project, chunk }) {
    yield* ensureUrl
    const located = Option.isSome(project) && Option.isSome(chunk)
      ? { projectSlug: project.value, chunkId: chunk.value }
      : Option.isNone(project) && Option.isNone(chunk)
        ? yield* readLeaseNear(process.cwd())
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
        `${row.createdAt}  ${status.padEnd(8)}  ${row.displayName}${score}`
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
      const lease = yield* readLeaseNear(process.cwd())
      const client = yield* ApiClient
      const next = yield* client.chunks.heartbeat({
        params: {
          projectSlug: lease.projectSlug,
          chunkId: lease.chunkId
        },
        payload: { leaseToken: lease.leaseToken }
      })
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
    watch
  ]),
  Command.run({ version: "0.0.0" }),
  Effect.provide(MainLive),
  NodeRuntime.runMain
)
