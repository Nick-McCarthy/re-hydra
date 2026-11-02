import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { Unauthorized } from "effect/http-api/HttpApiError"
import { LinkJobResult, LinkJobRequest, MatchJobAccepted, MatchJobRequest } from "./domain/Job.js"
import { MatchdAuth } from "./http/MatchdAuth.js"

export const HealthGroup = HttpApiGroup.make("health").add(
  HttpApiEndpoint.get("get", "/health", {
    success: Schema.Struct({
      ok: Schema.Literal(true),
      service: Schema.Literal("re-hydra-matchd")
    })
  })
)

export const JobsGroup = HttpApiGroup.make("jobs")
  .add(
    HttpApiEndpoint.post("run", "/jobs", {
      payload: MatchJobRequest,
      success: MatchJobAccepted,
      error: [Unauthorized]
    }).middleware(MatchdAuth)
  )
  .add(
    HttpApiEndpoint.post("link", "/link-jobs", {
      payload: LinkJobRequest,
      success: LinkJobResult,
      error: [Unauthorized]
    }).middleware(MatchdAuth)
  )

export const Api = HttpApi.make("re-hydra-matchd")
  .add(HealthGroup)
  .add(JobsGroup)
  .prefix("/v1")
