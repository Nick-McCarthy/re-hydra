import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../Api.js"
import { ImportsRepo } from "../services/ImportsRepo.js"
import { CurrentUser } from "./Authorization.js"

export const ImportsLive = HttpApiBuilder.group(Api, "imports", (handlers) =>
  handlers.handle("create", (request) =>
    Effect.gen(function*() {
      const user = yield* CurrentUser
      const repo = yield* ImportsRepo
      return yield* repo.importExport(
        request.params.projectSlug,
        user.id,
        request.payload
      )
    })
  )
)
