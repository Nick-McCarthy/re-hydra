#!/usr/bin/env npx tsx
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { readFileSync } from "node:fs"
import * as path from "node:path"
import { Console, Effect, Layer, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
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
    )
  }),
  Command.withDescription("re-hydra contributor CLI")
)

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
    email: Argument.String("email").pipe(
      Argument.withDescription("Email for magic link"),
      Argument.optional
    ),
    token: Flag.String("token").pipe(
      Flag.withDescription("Existing session token (skip magic link)"),
      Flag.optional
    ),
    consume: Flag.String("consume").pipe(
      Flag.withDescription("Magic-link token to exchange for a session"),
      Flag.optional
    )
  },
  Effect.fn(function*({ email, token, consume }) {
    yield* ensureUrl
    const client = yield* ApiClient
    const config = yield* loadConfig
    const root = yield* hydra

    if (Option.isSome(token)) {
      yield* saveConfig({ baseUrl: root.url, token: token.value })
      yield* Console.log("Session saved.")
      return
    }

    if (Option.isSome(consume)) {
      const session = yield* client.auth.consumeMagicLink({
        payload: { token: consume.value }
      })
      yield* saveConfig({ baseUrl: root.url, token: session.token })
      yield* Console.log(`Logged in as ${session.user.email}`)
      return
    }

    if (Option.isNone(email)) {
      return yield* Effect.fail(
        new Error(
          "Usage: hydra login <email> | hydra login --token <session> | hydra login --consume <magic-token>"
        )
      )
    }

    const requested = yield* client.auth.requestMagicLink({
      payload: { email: email.value }
    })

    if (requested.devToken !== undefined) {
      const session = yield* client.auth.consumeMagicLink({
        payload: { token: requested.devToken }
      })
      yield* saveConfig({ baseUrl: root.url, token: session.token })
      yield* Console.log(`Logged in as ${session.user.email} (dev token)`)
      return
    }

    yield* saveConfig({
      baseUrl: root.url,
      ...(config.token !== undefined ? { token: config.token } : {})
    })
    yield* Console.log(
      "Magic link requested. Check the API console (or email), then run:"
    )
    yield* Console.log("  hydra login --consume <magic-token>")
  })
).pipe(Command.withDescription("Log in via magic link or session token"))

const logout = Command.make(
  "logout",
  {},
  Effect.fn(function*() {
    yield* ensureUrl
    const client = yield* ApiClient
    const config = yield* loadConfig
    if (config.token !== undefined) {
      yield* client.auth.logout({}).pipe(Effect.ignore)
    }
    yield* saveConfig({ baseUrl: config.baseUrl })
    yield* Console.log("Logged out.")
  })
).pipe(Command.withDescription("Revoke the local session"))

const me = Command.make(
  "me",
  {},
  Effect.fn(function*() {
    yield* ensureUrl
    const client = yield* ApiClient
    const user = yield* client.auth.me({})
    yield* Console.log(`${user.displayName} <${user.email}> (${user.id})`)
  })
).pipe(Command.withDescription("Show the current user"))

const list = Command.make(
  "list",
  {
    project: Argument.String("project").pipe(
      Argument.withDescription("Project slug")
    )
  },
  Effect.fn(function*({ project }) {
    yield* ensureUrl
    const client = yield* ApiClient
    const chunks = yield* client.chunks.list({
      params: { projectSlug: project }
    })
    if (chunks.length === 0) {
      yield* Console.log("No chunks.")
      return
    }
    for (const chunk of chunks) {
      yield* Console.log(
        `${chunk.id}  ${chunk.state.padEnd(10)}  ${chunk.address}  ${chunk.name}`
      )
    }
  })
).pipe(Command.withDescription("List chunks in a project"))

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

    yield* Console.log(`Checked out ${lease.chunk.name}`)
    yield* Console.log(`  workdir:  ${dir}`)
    yield* Console.log(`  lease:    ${lease.leaseToken}`)
    yield* Console.log(`  expires:  ${lease.leaseExpiresAt}`)
    yield* Console.log(`  agent:    ${path.join(dir, "instructions.agent")}`)
    yield* Console.log(`  edit:     ${path.join(dir, "candidate.c")}`)
    yield* Console.log("  submit:   hydra submit")
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
      yield* Console.log("Matching…")
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

    yield* Console.log(`Submitted ${path.basename(sourcePath)}`)
    yield* Console.log(`  attempt:  ${current.attemptId}`)
    yield* Console.log(`  job:      ${current.jobId}`)
    yield* Console.log(`  state:    ${current.state}`)
    if (current.score !== null) {
      yield* Console.log(`  score:    ${current.score}`)
    }
    if (current.matched !== null) {
      yield* Console.log(`  matched:  ${current.matched}`)
    }
    if (current.diagnostics !== null && current.diagnostics.length > 0) {
      yield* Console.log("--- diagnostics ---")
      yield* Console.log(current.diagnostics)
    } else if (current.state !== "finished") {
      yield* Console.log("Match is still running. Check the chunk page for the result.")
    }
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
    yield* Console.log(`Released ${chunk.name} (${chunk.state})`)
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
    yield* Console.log(`Lease extended to ${next.leaseExpiresAt}`)
  })
).pipe(Command.withDescription("Extend the current lease"))

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
    heartbeat
  ]),
  Command.run({ version: "0.0.0" }),
  Effect.provide(MainLive),
  NodeRuntime.runMain
)
