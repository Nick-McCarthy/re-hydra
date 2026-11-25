import { Api } from "@re-hydra/api/Api"
import { Authorization } from "@re-hydra/api/http/Authorization"
import { Context, Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { HttpApiClient, HttpApiMiddleware } from "effect/http-api"
import { loadConfig } from "./config.js"

export class ApiClient extends Context.Service<
  ApiClient,
  HttpApiClient.ForApi<typeof Api>
>()("rehydra/cli/ApiClient") {}

const AuthorizationClient = HttpApiMiddleware.layerClient(
  Authorization,
  ({ next, request }) =>
    Effect.gen(function*() {
      const config = yield* loadConfig
      if (config.token === undefined) {
        return yield* next(request)
      }
      return yield* next(HttpClientRequest.bearerToken(request, config.token))
    })
)

// The base URL is read per request: `hydra --url …` saves it after the client
// is built, and that same command's requests must go to the new URL.
// The token goes on every request, not only those that require sign-in:
// public endpoints show a signed-in viewer more (a submitter sees the byte
// comparison of their own attempt).
export const ApiClientLive = Layer.effect(
  ApiClient,
  HttpApiClient.make(Api, {
    transformClient: (client) =>
      client.pipe(
        HttpClient.mapRequestEffect((request) =>
          Effect.map(loadConfig, (config) => {
            const located = HttpClientRequest.prependUrl(request, config.baseUrl)
            return config.token === undefined || config.token.length === 0
              ? located
              : HttpClientRequest.bearerToken(located, config.token)
          })
        )
      )
  })
).pipe(
  Layer.provide(AuthorizationClient),
  Layer.provide(FetchHttpClient.layer)
)
