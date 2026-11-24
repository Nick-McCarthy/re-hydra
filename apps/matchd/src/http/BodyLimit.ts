import { ByteSize, Config, Effect } from "effect"
import { HttpIncomingMessage, HttpRouter } from "effect/http"

/**
 * Caps request bodies (audit A-034). Effect leaves `MaxBodySize` unset by
 * default, which reads any body into memory. A link job carries every unit's
 * source, so the default is generous: `MATCHD_MAX_BODY_MB`, 64 MiB.
 */
export const BodyLimitLive = HttpRouter.middleware(
  Effect.gen(function*() {
    const maxMb = yield* Config.Int("MATCHD_MAX_BODY_MB").pipe(Config.withDefault(64))
    const max = ByteSize.megabytes(maxMb)
    return (httpEffect) => httpEffect.pipe(Effect.provideService(HttpIncomingMessage.MaxBodySize, max))
  }),
  { global: true }
)
