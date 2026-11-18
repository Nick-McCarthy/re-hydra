import { Config, Context, Effect, Layer, Ref } from "effect"
import { parseMatchdRoutes } from "./matchdRoutes.js"
import { pickUrl, scaleCooldownMs } from "./matchdScale.js"

export type MatchdReplica = {
  readonly url: string
  readonly container: string
}

type ImagePool = {
  readonly warm: ReadonlyArray<string>
  readonly extras: ReadonlyArray<MatchdReplica>
  readonly pending: boolean
  readonly lastScaleOutAt: number
}

type PoolState = {
  readonly images: ReadonlyMap<string, ImagePool>
  readonly inflight: ReadonlyMap<string, number>
  readonly defaultUrl: string
}

export type PoolView = {
  readonly image: string
  readonly urls: number
  readonly warm: number
  readonly extras: ReadonlyArray<MatchdReplica>
  readonly pending: boolean
  readonly lastScaleOutAt: number
}

const emptyImage = (warm: ReadonlyArray<string>): ImagePool => ({
  warm,
  extras: [],
  pending: false,
  lastScaleOutAt: 0
})

const urlsOf = (row: ImagePool): ReadonlyArray<string> => [
  ...row.warm,
  ...row.extras.map((extra) => extra.url)
]

export class MatchdPool extends Context.Service<
  MatchdPool,
  {
    readonly acquire: (image: string) => Effect.Effect<string>
    readonly release: (url: string) => Effect.Effect<void>
    readonly view: Effect.Effect<ReadonlyArray<PoolView>>
    readonly beginScaleOut: (
      image: string,
      now: number,
      maxUrls: number
    ) => Effect.Effect<boolean>
    readonly cancelScaleOut: (image: string) => Effect.Effect<void>
    readonly addReplica: (
      image: string,
      replica: MatchdReplica,
      now: number
    ) => Effect.Effect<void>
    readonly takeReplica: (image: string) => Effect.Effect<MatchdReplica | undefined>
  }
>()("rehydra/services/MatchdPool") {
  static readonly layer = Layer.effect(
    MatchdPool,
    Effect.gen(function*() {
      const defaultRaw = yield* Config.String("MATCHD_URL").pipe(
        Config.withDefault("http://127.0.0.1:3001")
      )
      const routesRaw = yield* Config.String("MATCHD_ROUTES").pipe(
        Config.withDefault("")
      )
      const parsed = parseMatchdRoutes(routesRaw)
      if (!parsed.ok) {
        return yield* Effect.fail(new Error(`MATCHD_ROUTES: ${parsed.reason}`))
      }
      const defaultUrl = defaultRaw.replace(/\/$/, "")
      const images = new Map<string, ImagePool>()
      for (const [image, urls] of parsed.routes) {
        images.set(image, emptyImage(urls))
      }
      const state = yield* Ref.make<PoolState>({
        images,
        inflight: new Map(),
        defaultUrl
      })

      const rowFor = (current: PoolState, image: string): ImagePool =>
        current.images.get(image) ?? emptyImage([current.defaultUrl])

      const acquire = Effect.fn("MatchdPool.acquire")(function*(image: string) {
        return yield* Ref.modify(state, (current) => {
          const row = rowFor(current, image)
          const url = pickUrl(urlsOf(row), current.inflight)
          const inflight = new Map(current.inflight)
          inflight.set(url, (inflight.get(url) ?? 0) + 1)
          return [url, { ...current, inflight }] as const
        })
      })

      const release = Effect.fn("MatchdPool.release")(function*(url: string) {
        yield* Ref.update(state, (current) => {
          const inflight = new Map(current.inflight)
          inflight.set(url, Math.max(0, (inflight.get(url) ?? 1) - 1))
          return { ...current, inflight }
        })
      })

      const view = Ref.get(state).pipe(
        Effect.map((current) =>
          [...current.images].map(([image, row]) => ({
            image,
            urls: urlsOf(row).length,
            warm: row.warm.length,
            extras: row.extras,
            pending: row.pending,
            lastScaleOutAt: row.lastScaleOutAt
          }))
        )
      )

      const beginScaleOut = Effect.fn("MatchdPool.beginScaleOut")(function*(
        image: string,
        now: number,
        maxUrls: number
      ) {
        return yield* Ref.modify(state, (current) => {
          const row = rowFor(current, image)
          const count = urlsOf(row).length
          const cooling = row.lastScaleOutAt > 0 && now - row.lastScaleOutAt < scaleCooldownMs
          if (row.pending || cooling || count >= maxUrls) {
            return [false, current] as const
          }
          const imagesNext = new Map(current.images)
          imagesNext.set(image, { ...row, pending: true })
          return [true, { ...current, images: imagesNext }] as const
        })
      })

      const cancelScaleOut = Effect.fn("MatchdPool.cancelScaleOut")(function*(image: string) {
        yield* Ref.update(state, (current) => {
          const row = current.images.get(image)
          if (row === undefined) return current
          const imagesNext = new Map(current.images)
          imagesNext.set(image, { ...row, pending: false })
          return { ...current, images: imagesNext }
        })
      })

      const addReplica = Effect.fn("MatchdPool.addReplica")(function*(
        image: string,
        replica: MatchdReplica,
        now: number
      ) {
        yield* Ref.update(state, (current) => {
          const row = rowFor(current, image)
          const known = urlsOf(row).includes(replica.url)
          const imagesNext = new Map(current.images)
          imagesNext.set(image, {
            ...row,
            pending: false,
            lastScaleOutAt: now,
            extras: known ? row.extras : [...row.extras, replica]
          })
          return { ...current, images: imagesNext }
        })
      })

      const takeReplica = Effect.fn("MatchdPool.takeReplica")(function*(image: string) {
        return yield* Ref.modify(state, (current) => {
          const row = current.images.get(image)
          const replica = row?.extras.at(-1)
          if (row === undefined || replica === undefined) {
            return [undefined, current] as const
          }
          const imagesNext = new Map(current.images)
          imagesNext.set(image, { ...row, extras: row.extras.slice(0, -1) })
          return [replica, { ...current, images: imagesNext }] as const
        })
      })

      return MatchdPool.of({
        acquire,
        release,
        view,
        beginScaleOut,
        cancelScaleOut,
        addReplica,
        takeReplica
      })
    })
  )
}
