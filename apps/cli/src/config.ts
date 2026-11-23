import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs"
import { homedir } from "node:os"
import * as path from "node:path"
import { Effect, Option, Schema } from "effect"

export const CliConfig = Schema.Struct({
  baseUrl: Schema.String,
  token: Schema.optionalKey(Schema.String),
  kind: Schema.optionalKey(Schema.Literals(["session", "token"]))
})

export type CliConfig = typeof CliConfig.Type

export const LeaseState = Schema.Struct({
  projectSlug: Schema.String,
  chunkId: Schema.String,
  chunkName: Schema.String,
  leaseToken: Schema.String,
  leaseExpiresAt: Schema.String,
  workDir: Schema.String
})

export type LeaseState = typeof LeaseState.Type

const configDir = (): string => {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? homedir(), "re-hydra")
  }
  return path.join(homedir(), ".config", "re-hydra")
}

const configPath = (): string => path.join(configDir(), "config.json")

export const defaultBaseUrl = "http://localhost:3000"

export const loadConfig: Effect.Effect<CliConfig> = Effect.sync(() => {
  const file = configPath()
  if (!existsSync(file)) {
    return { baseUrl: defaultBaseUrl }
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
    const decoded = Schema.decodeUnknownOption(CliConfig)(parsed)
    if (Option.isSome(decoded)) {
      return decoded.value
    }
  } catch {
    // fall through
  }
  return { baseUrl: defaultBaseUrl }
})

export const saveConfig = (config: CliConfig): Effect.Effect<void> =>
  Effect.sync(() => {
    mkdirSync(configDir(), { recursive: true })
    writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`, "utf8")
  })

export const requireToken: Effect.Effect<CliConfig, Error> = Effect.gen(function*() {
  const config = yield* loadConfig
  if (config.token === undefined || config.token.length === 0) {
    return yield* Effect.fail(
      new Error(
        "Not logged in. Run: hydra login"
      )
    )
  }
  return config
})

export const writeLease = (lease: LeaseState): Effect.Effect<void> =>
  Effect.sync(() => {
    writeFileSync(
      path.join(lease.workDir, ".lease.json"),
      `${JSON.stringify(lease, null, 2)}\n`,
      "utf8"
    )
  })

export const readLeaseNear = (
  startDir: string
): Effect.Effect<LeaseState, Error> =>
  Effect.gen(function*() {
    let dir = path.resolve(startDir)
    for (let i = 0; i < 8; i++) {
      const leasePath = path.join(dir, ".lease.json")
      if (existsSync(leasePath)) {
        const raw = yield* Effect.try({
          try: () => readFileSync(leasePath, "utf8"),
          catch: () => new Error(`Could not read lease file: ${leasePath}`)
        })
        const parsed = yield* Effect.try({
          try: () => JSON.parse(raw) as unknown,
          catch: () => new Error(`Invalid lease file: ${leasePath}`)
        })
        return yield* Schema.decodeUnknownEffect(LeaseState)(parsed).pipe(
          Effect.mapError(() => new Error(`Invalid lease file: ${leasePath}`))
        )
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return yield* Effect.fail(
      new Error(
        "No .lease.json found. Run hydra checkout first, or cd into the work directory."
      )
    )
  })
