import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Config, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { HttpApiBuilder, HttpApiScalar } from "effect/http-api"
import { createServer } from "node:http"
import { Api } from "./Api.js"
import { HealthLive } from "./http/HealthLive.js"
import { JobsLive } from "./http/JobsLive.js"
import { MatchdAuthLive } from "./http/MatchdAuth.js"

const ApiHandlers = Layer.mergeAll(HealthLive, JobsLive)

const ApiLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(ApiHandlers),
  Layer.provide(MatchdAuthLive),
  Layer.provide(HttpApiScalar.layer(Api))
)

const HttpLive = HttpRouter.serve(ApiLive).pipe(
  Layer.provide(
    NodeHttpServer.layerConfig(createServer, {
      port: Config.Port("MATCHD_PORT").pipe(Config.withDefault(3001))
    })
  )
)

NodeRuntime.runMain(Layer.launch(HttpLive))
