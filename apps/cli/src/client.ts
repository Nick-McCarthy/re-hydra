import { Api } from "@re-hydra/api/Api"
import { Authorization } from "@re-hydra/api/http/Authorization"
import { Context, Effect, flow, Layer } from "effect"
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

export const ApiClientLive = Layer.effect(
  ApiClient,
  Effect.gen(function*() {
    const config = yield* loadConfig
    return yield* HttpApiClient.make(Api, {
      transformClient: (client) =>
        client.pipe(
          HttpClient.mapRequest(
            flow(HttpClientRequest.prependUrl(config.baseUrl))
          )
        )
    })
  })
).pipe(
  Layer.provide(AuthorizationClient),
  Layer.provide(FetchHttpClient.layer)
)
