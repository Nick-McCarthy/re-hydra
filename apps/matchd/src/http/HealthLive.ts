import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../Api.js"

export const HealthLive = HttpApiBuilder.group(Api, "health", (handlers) =>
  handlers.handle("get", () =>
    Effect.succeed({
      ok: true as const,
      service: "re-hydra-matchd" as const
    })
  )
)
