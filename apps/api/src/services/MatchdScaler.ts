import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { hostname } from "node:os"
import { fileURLToPath } from "node:url"
import { Config, Effect, Layer, Redacted, Result } from "effect"
import { SqlClient } from "effect/sql"
import { MatchdPool } from "./MatchdPool.js"
import { loadMatchdToken } from "./matchdToken.js"
import {
  decideScale,
  defaultScaleMax,
  localMatchdImage,
  parseDockerPort,
  scaleContainerName,
  scaleInIdleMs
} from "./matchdScale.js"

type WaitRow = {
  readonly image: string | null
  readonly queued: number
  readonly wait_s: number | string | null
  readonly claimed: number
}

/**
 * `env` is added to the docker CLI's own environment. `docker run -e NAME`
 * with no value copies NAME from there, so a secret never appears in the
 * command line that the host process list shows (audit A-021).
 */
const docker = (
  args: ReadonlyArray<string>,
  env?: Readonly<Record<string, string>>
): Effect.Effect<string, Error> =>
  Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        execFile(
          "docker",
          [...args],
          {
            timeout: 30_000,
            windowsHide: true,
            ...(env === undefined ? {} : { env: { ...process.env, ...env } })
          },
          (err, stdout, stderr) => {
            if (err) reject(new Error((stderr || err.message).trim()))
            else resolve(stdout)
          }
        )
      }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause)))
  })

const startReplica = (
  image: string,
  localImage: string,
  index: number,
  token: Redacted.Redacted<string>,
  seccompProfile: string
): Effect.Effect<{ readonly url: string; readonly container: string }, Error> =>
  Effect.gen(function*() {
    const container = scaleContainerName(localImage, index)
    const started = yield* docker([
      "run",
      "-d",
      "--name",
      container,
      "--label",
      "rehydra.scaler=1",
      "--label",
      `rehydra.toolchain=${image}`,
      "-p",
      "127.0.0.1::3001",
      "--security-opt",
      `seccomp=${seccompProfile}`,
      "-e",
      "MATCHD_TOKEN",
      localImage
    ], { MATCHD_TOKEN: Redacted.value(token) }).pipe(Effect.result)
    if (Result.isFailure(started)) return yield* Effect.fail(started.failure)
    const published = yield* docker(["port", container, "3001/tcp"]).pipe(Effect.result)
    const port = Result.isSuccess(published) ? parseDockerPort(published.success) : undefined
    if (port === undefined) {
      yield* docker(["rm", "-f", container]).pipe(Effect.ignore)
      return yield* Effect.fail(new Error(`docker did not publish a port for ${container}`))
    }
    return { url: `http://127.0.0.1:${port}`, container }
  })

/**
 * Adds a copy of a compiler image when an interactive job has waited 30 seconds,
 * and removes that copy after the image has been idle. The warm process from
 * MATCHD_URL or MATCHD_ROUTES stays up. The job queue stays in Postgres.
 */
export const MatchdScalerLive = Layer.effectDiscard(Effect.gen(function*() {
  const mode = yield* Config.String("MATCHD_SCALE").pipe(Config.withDefault("docker"))
  if (mode === "off") {
    yield* Effect.logInfo("matchd scaler off")
    return
  }
  if (mode !== "docker") {
    return yield* Effect.fail(new Error("MATCHD_SCALE must be off or docker"))
  }
  const maxUrls = Math.min(
    8,
    Math.max(1, yield* Config.Int("MATCHD_SCALE_MAX").pipe(Config.withDefault(defaultScaleMax)))
  )
  const token = yield* loadMatchdToken
  // The same profile compose uses, so a scaled copy can start its bwrap
  // sandbox (audit A-027). MATCHD_SECCOMP_PROFILE overrides the repo copy.
  const seccompProfile = yield* Config.String("MATCHD_SECCOMP_PROFILE").pipe(
    Config.withDefault(fileURLToPath(new URL("../../../../docker-yml/matchd-seccomp.json", import.meta.url)))
  )
  if (!existsSync(seccompProfile)) {
    return yield* Effect.fail(
      new Error(`MATCHD_SCALE=docker needs the matchd seccomp profile. Not found: ${seccompProfile}`)
    )
  }
  const sql = yield* SqlClient.SqlClient
  const pool = yield* MatchdPool
  const idleSince = new Map<string, number>()
  let dockerQuietUntil = 0
  let dockerWarned = false

  const noteDocker = (failed: boolean) =>
    Effect.gen(function*() {
      if (!failed) {
        dockerQuietUntil = 0
        if (dockerWarned) {
          dockerWarned = false
          yield* Effect.logInfo("matchd scaler can reach docker again")
        }
        return
      }
      dockerQuietUntil = Date.now() + 60_000
      if (!dockerWarned) {
        dockerWarned = true
        yield* Effect.logWarning("matchd scaler cannot reach docker; warm processes stay as they are")
      }
    })

  yield* Effect.gen(function*() {
    const listed = yield* docker([
      "ps",
      "-a",
      "--filter",
      "label=rehydra.scaler=1",
      "--format",
      "{{.Names}}"
    ]).pipe(Effect.result)
    if (Result.isFailure(listed)) {
      yield* noteDocker(true)
      return
    }
    yield* noteDocker(false)
    for (const name of listed.success.split(/\r?\n/)) {
      const container = name.trim()
      if (!/^rehydra-scale-[a-z0-9-]+$/i.test(container)) continue
      const inspected = yield* docker([
        "inspect",
        "--format",
        "{{.Config.Labels.rehydra.toolchain}}|{{.State.Running}}",
        container
      ]).pipe(Effect.result)
      if (Result.isFailure(inspected)) continue
      const [image, running] = inspected.success.trim().split("|")
      if (image === undefined || localMatchdImage[image] === undefined) continue
      if (running !== "true") {
        yield* docker(["rm", "-f", container]).pipe(Effect.ignore)
        continue
      }
      const published = yield* docker(["port", container, "3001/tcp"]).pipe(Effect.result)
      if (Result.isFailure(published)) continue
      const port = parseDockerPort(published.success)
      if (port === undefined) continue
      yield* pool.addReplica(image, { url: `http://127.0.0.1:${port}`, container }, Date.now())
    }
  }).pipe(Effect.ignore)

  /**
   * Audit A-018. With several API processes, each would start its own copies
   * for the same queue. The leader holds row 1 of scaler_leader and renews it
   * every tick (10 s) for 30 s. Another process takes over once it lapses.
   */
  const holderId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
  let leading: boolean | undefined
  const takeLeadership = Effect.gen(function*() {
    const rows = yield* sql<{ readonly holder: string }>`
      INSERT INTO scaler_leader (id, holder, expires_at)
      VALUES (1, ${holderId}, now() + interval '30 seconds')
      ON CONFLICT (id) DO UPDATE
        SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
        WHERE scaler_leader.holder = EXCLUDED.holder
           OR scaler_leader.expires_at < now()
      RETURNING holder
    `
    const now = rows[0] !== undefined
    if (now !== leading) {
      leading = now
      yield* Effect.logInfo(now
        ? `matchd scaler: this process (${holderId}) is the leader`
        : "matchd scaler: another API process is the leader; this one waits")
    }
    return now
  })

  const tick = Effect.gen(function*() {
    if (!(yield* takeLeadership)) return
    if (Date.now() < dockerQuietUntil) return
    const waits = yield* sql<WaitRow>`
      SELECT
        toolchain->>'image' AS image,
        CAST(COUNT(*) FILTER (WHERE state = 'queued' AND kind = 'interactive') AS int) AS queued,
        COALESCE(
          EXTRACT(EPOCH FROM (
            now() - MIN(created_at) FILTER (WHERE state = 'queued' AND kind = 'interactive')
          )),
          0
        ) AS wait_s,
        CAST(COUNT(*) FILTER (WHERE state = 'claimed') AS int) AS claimed
      FROM jobs
      WHERE state IN ('queued', 'claimed')
      GROUP BY toolchain->>'image'
    `
    const recipes = yield* sql<{ readonly image: string | null; readonly claimed: number }>`
      SELECT toolchain->>'image' AS image, CAST(COUNT(*) AS int) AS claimed
      FROM recipe_jobs
      WHERE state = 'claimed'
      GROUP BY toolchain->>'image'
    `
    const claimedByImage = new Map<string, number>()
    for (const row of waits) {
      if (row.image === null || row.image.length === 0) continue
      claimedByImage.set(row.image, Number(row.claimed))
    }
    for (const row of recipes) {
      if (row.image === null || row.image.length === 0) continue
      claimedByImage.set(row.image, (claimedByImage.get(row.image) ?? 0) + Number(row.claimed))
    }
    const waitByImage = new Map<string, { readonly queued: number; readonly waitMs: number }>()
    for (const row of waits) {
      if (row.image === null || row.image.length === 0) continue
      waitByImage.set(row.image, {
        queued: Number(row.queued),
        waitMs: Number(row.wait_s) * 1000
      })
    }

    const now = Date.now()
    const known = new Set<string>([...waitByImage.keys(), ...claimedByImage.keys()])
    const current = yield* pool.view
    for (const row of current) {
      if (row.extras.length > 0) known.add(row.image)
    }

    const ranked = [...known].sort((a, b) => (waitByImage.get(b)?.waitMs ?? 0) - (waitByImage.get(a)?.waitMs ?? 0))
    let scaled = false
    for (const image of ranked) {
      const localImage = localMatchdImage[image]
      if (localImage === undefined) continue
      const row = current.find((item) => item.image === image)
      const queued = waitByImage.get(image)?.queued ?? 0
      const claimed = claimedByImage.get(image) ?? 0
      const busy = queued > 0 || claimed > 0
      const since = busy ? undefined : (idleSince.get(image) ?? now)
      if (busy) idleSince.delete(image)
      else idleSince.set(image, since ?? now)
      const decision = decideScale({
        waitMs: waitByImage.get(image)?.waitMs ?? 0,
        queued,
        claimed,
        urls: row?.urls ?? 1,
        warm: row?.warm ?? 1,
        maxUrls,
        pending: row?.pending ?? false,
        idleMs: busy ? 0 : now - (since ?? now)
      })
      if (decision === "out") {
        const started = yield* pool.beginScaleOut(image, now, maxUrls)
        if (!started) continue
        const created = yield* startReplica(
          image,
          localImage,
          (row?.urls ?? 1) + 1,
          token,
          seccompProfile
        ).pipe(Effect.result)
        if (Result.isFailure(created)) {
          yield* pool.cancelScaleOut(image)
          const container = scaleContainerName(localImage, (row?.urls ?? 1) + 1)
          const existing = yield* docker([
            "inspect",
            "--format",
            "{{.Config.Labels.rehydra.toolchain}}|{{.State.Running}}",
            container
          ]).pipe(Effect.result)
          if (Result.isSuccess(existing) && existing.success.trim() === `${image}|true`) {
            const published = yield* docker(["port", container, "3001/tcp"]).pipe(Effect.result)
            const port = Result.isSuccess(published) ? parseDockerPort(published.success) : undefined
            if (port !== undefined) {
              yield* pool.addReplica(image, { url: `http://127.0.0.1:${port}`, container }, Date.now())
              yield* noteDocker(false)
              return
            }
          }
          yield* noteDocker(true)
          return
        }
        yield* noteDocker(false)
        yield* pool.addReplica(image, created.success, Date.now())
        yield* Effect.logInfo(`matchd copy started for ${image} at ${created.success.url}`)
        scaled = true
        break
      }
    }
    if (scaled) return

    for (const image of ranked) {
      const row = current.find((item) => item.image === image)
      if (row === undefined || row.extras.length === 0) continue
      const queued = waitByImage.get(image)?.queued ?? 0
      const claimed = claimedByImage.get(image) ?? 0
      const since = idleSince.get(image)
      const decision = decideScale({
        waitMs: 0,
        queued,
        claimed,
        urls: row.urls,
        warm: row.warm,
        maxUrls,
        pending: row.pending,
        idleMs: since === undefined ? 0 : now - since
      })
      if (decision !== "in") continue
      const busy = yield* sql<{ readonly busy: number }>`
        SELECT (
          SELECT CAST(COUNT(*) AS int) FROM jobs
          WHERE state IN ('queued', 'claimed')
            AND toolchain->>'image' = ${image}
        ) + (
          SELECT CAST(COUNT(*) AS int) FROM recipe_jobs
          WHERE state = 'claimed'
            AND toolchain->>'image' = ${image}
        ) AS busy
      `
      if (Number(busy[0]?.busy ?? 0) > 0) {
        idleSince.delete(image)
        continue
      }
      const replica = yield* pool.takeReplica(image)
      if (replica === undefined) continue
      const removed = yield* docker(["rm", "-f", replica.container]).pipe(Effect.result)
      if (Result.isFailure(removed)) {
        yield* pool.addReplica(image, replica, now)
        yield* noteDocker(true)
        return
      }
      yield* Effect.logInfo(`matchd copy stopped for ${image}`)
      break
    }
  })

  yield* Effect.logInfo(`matchd scaler started (max ${maxUrls} copies per image)`)
  yield* tick.pipe(
    Effect.catchCause((cause) => Effect.logWarning("matchd scaler tick failed", cause)),
    Effect.andThen(Effect.sleep("10 seconds")),
    Effect.forever,
    Effect.forkScoped
  )
}))
