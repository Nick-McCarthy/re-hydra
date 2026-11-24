import { ByteSize, Config, Effect, Option, Result } from "effect"
import { HttpIncomingMessage, HttpMiddleware, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { IpNetwork } from "effect/net"
import { RateLimits } from "../services/RateLimits.js"
import { globalRule, isImportPath, matchingRules } from "./rateLimit.js"

/**
 * Audit A-037. The API serves JSON, so it can refuse everything a browser
 * might do with a response beyond reading it. /docs (the Scalar reference)
 * loads its own script and styles, so it gets the same headers without the
 * strict content policy. HSTS is opt-in with API_HSTS=on, for when the API is
 * served over HTTPS.
 */
const baseHeaders = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin"
}
const apiCsp = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
const hstsValue = "max-age=31536000; includeSubDomains"

const tooMany = (retryAfterSeconds: number) =>
  HttpServerResponse.jsonUnsafe(
    {
      type: "https://re-hydra.dev/problems/too-many-requests",
      title: "Too many requests",
      status: 429,
      detail: `Too many requests. Try again in ${retryAfterSeconds} seconds.`
    },
    {
      status: 429,
      contentType: "application/problem+json",
      headers: { "retry-after": String(retryAfterSeconds) }
    }
  )

/**
 * Runs before every route (audit A-034, A-035).
 *
 * - `TRUSTED_PROXIES` (comma-separated CIDRs) makes `X-Forwarded-For` from
 *   those proxies the client address. Without it the socket address is used,
 *   which behind a load balancer is the balancer, so set it in production.
 * - Per-address limits by route, plus a flood backstop on every request.
 *   Refused requests get 429 with `Retry-After`.
 * - Request bodies are capped at `API_MAX_BODY_MB` (default 4), or
 *   `API_MAX_IMPORT_MB` (default 64) on the import route. A larger body is
 *   refused with 413 while it is being read.
 */
export const EdgeMiddlewareLive = HttpRouter.middleware(
  Effect.gen(function*() {
    const limits = yield* RateLimits
    const maxBodyMb = yield* Config.Int("API_MAX_BODY_MB").pipe(Config.withDefault(4))
    const maxImportMb = yield* Config.Int("API_MAX_IMPORT_MB").pipe(Config.withDefault(64))
    const proxiesRaw = yield* Config.String("TRUSTED_PROXIES").pipe(Config.withDefault(""))
    const hsts = (yield* Config.String("API_HSTS").pipe(Config.withDefault("off"))) === "on"

    const trustedProxies: Array<IpNetwork.IpNetwork> = []
    for (const entry of proxiesRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
      const parsed = IpNetwork.fromString(entry)
      if (Result.isFailure(parsed)) {
        return yield* Effect.die(new Error(`TRUSTED_PROXIES: cannot parse '${entry}' as a CIDR`))
      }
      trustedProxies.push(parsed.success)
    }
    const forwarded = trustedProxies.length > 0
      ? HttpMiddleware.xForwardedHeaders({ trustedProxies })
      : <E, R>(app: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>) => app

    const defaultBody = ByteSize.megabytes(maxBodyMb)
    const importBody = ByteSize.megabytes(maxImportMb)

    const securityHeaders = (path: string) => ({
      ...baseHeaders,
      ...(path === "/docs" || path.startsWith("/docs/") ? {} : { "content-security-policy": apiCsp }),
      ...(hsts ? { "strict-transport-security": hstsValue } : {})
    })

    return (httpEffect) =>
      forwarded(Effect.gen(function*() {
        const request = yield* HttpServerRequest.HttpServerRequest
        const path = request.url.split("?")[0] ?? request.url
        const withHeaders = HttpServerResponse.setHeaders(securityHeaders(path))
        const client = Option.getOrElse(request.remoteAddress, () => "unknown")

        for (const rule of [...matchingRules(request.method, path), globalRule]) {
          const taken = limits.take(`${rule.name}:${client}`, rule.limit, rule.windowMs)
          if (!taken.ok) {
            yield* Effect.logWarning(`rate limit ${rule.name} for ${client} on ${request.method} ${path}`)
            return withHeaders(tooMany(taken.retryAfterSeconds))
          }
        }

        return yield* httpEffect.pipe(
          Effect.provideService(HttpIncomingMessage.MaxBodySize, isImportPath(path) ? importBody : defaultBody),
          Effect.map(withHeaders)
        )
      }))
  }),
  { global: true }
)
