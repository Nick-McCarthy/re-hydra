import { Console, Effect, Option } from "effect"
import { Command, Flag } from "effect/cli"
import { defaultBaseUrl, loadConfig, readLeaseNear, saveConfig } from "./config.js"
import { ExitCode, HydraExit } from "./work.js"

/** The root command and its shared flags. Every subcommand reads them with `yield* hydra`. */
export const hydra = Command.make("hydra").pipe(
  Command.withSharedFlags({
    url: Flag.String("url").pipe(
      Flag.withDescription(`API base URL. Saved for later commands. Default ${defaultBaseUrl}`),
      Flag.optional
    ),
    json: Flag.Boolean("json").pipe(
      Flag.withDescription("Print API JSON"),
      Flag.withDefault(false)
    )
  }),
  Command.withDescription("re-hydra contributor CLI")
)

/** Print `value` as JSON with --json, else the lines. */
export const say = (value: unknown, lines: ReadonlyArray<string>) =>
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

/**
 * Save --url when it is given. Without it, commands use the saved URL; a
 * default here used to overwrite the URL a login had saved.
 */
export const ensureUrl = Effect.gen(function*() {
  const root = yield* hydra
  if (Option.isNone(root.url)) return
  const config = yield* loadConfig
  if (config.baseUrl !== root.url.value) {
    yield* saveConfig({ ...config, baseUrl: root.url.value })
  }
})

export const currentUrl = Effect.map(loadConfig, (config) => config.baseUrl)

/** The lease in this directory or a parent; exit code 5 when there is none. */
export const currentLease = readLeaseNear(process.cwd()).pipe(
  Effect.mapError((error) => new HydraExit({ code: ExitCode.noLease, message: error.message }))
)

/** --project when given, else the project of the checkout in this directory. */
export const projectOr = (flag: Option.Option<string>) =>
  Option.isSome(flag)
    ? Effect.succeed(flag.value)
    : currentLease.pipe(
      Effect.map((lease) => lease.projectSlug),
      Effect.mapError(() =>
        new HydraExit({ code: 1, message: "Pass --project <slug>, or run this inside a checkout." })
      )
    )
