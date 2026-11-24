import { Config, Context, Effect, Layer } from "effect"
import { FixedWindowLimiter, type Take } from "../http/rateLimit.js"

/**
 * One shared limiter per API process (audit A-035). `RATE_LIMITS=off` turns
 * every check into a pass, for local test runs that sign up many accounts.
 */
export class RateLimits extends Context.Service<
  RateLimits,
  {
    readonly enabled: boolean
    readonly take: (key: string, limit: number, windowMs: number) => Take
  }
>()("rehydra/services/RateLimits") {
  static readonly layer = Layer.effect(
    RateLimits,
    Effect.gen(function*() {
      const mode = yield* Config.String("RATE_LIMITS").pipe(Config.withDefault("on"))
      const enabled = mode !== "off"
      if (!enabled) {
        yield* Effect.logWarning("RATE_LIMITS=off: no rate limiting. Do not deploy with this.")
      }
      const limiter = new FixedWindowLimiter()
      return RateLimits.of({
        enabled,
        take: (key, limit, windowMs) =>
          enabled ? limiter.take(key, limit, windowMs) : { ok: true, remaining: limit }
      })
    })
  )
}
