import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../Api.js"
import { runMatchJob } from "../compile.js"
import { runLinkJob } from "../link.js"

export const JobsLive = HttpApiBuilder.group(Api, "jobs", (handlers) =>
  handlers
    .handle("run", (request) =>
      Effect.gen(function*() {
        const result = yield* runMatchJob(request.payload)
        return {
          jobId: request.payload.jobId,
          matched: result.matched,
          score: result.score,
          originalInsns: result.originalInsns,
          equalInsns: result.equalInsns,
          compilerOk: result.compilerOk,
          diagnostics: result.diagnostics,
          toolchainDigest: result.toolchainDigest,
          canonicalSha256: result.canonicalSha256
        }
      })
    )
    .handle("link", (request) =>
      Effect.gen(function*() {
        const result = yield* runLinkJob(request.payload)
        return {
          jobId: request.payload.jobId,
          compilerOk: result.compilerOk,
          diagnostics: result.diagnostics,
          toolchainDigest: result.toolchainDigest,
          units: result.units
        }
      })
    )
)
