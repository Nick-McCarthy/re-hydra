import { Context, Effect, flow, Layer, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { MatchdPool } from "./MatchdPool.js"
import { loadMatchdToken } from "./matchdToken.js"

const SourceLanguage = Schema.Literals(["c", "cpp"])

export const MatchJobRequest = Schema.Struct({
  jobId: Schema.String,
  arch: Schema.String,
  language: Schema.optionalKey(SourceLanguage),
  toolchain: Schema.Struct({
    compiler: Schema.String,
    version: Schema.String,
    flags: Schema.Array(Schema.String),
    image: Schema.String
  }),
  flags: Schema.optionalKey(Schema.Array(Schema.String)),
  expectedToolchainDigest: Schema.optionalKey(Schema.String),
  allowInlineAsm: Schema.optionalKey(Schema.Boolean),
  entrySymbol: Schema.String,
  originalBytesBase64: Schema.String,
  sources: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      text: Schema.String
    })
  )
})

export type MatchJobRequest = typeof MatchJobRequest.Type

export const MatchJobResult = Schema.Struct({
  jobId: Schema.String,
  matched: Schema.Boolean,
  score: Schema.Finite,
  originalInsns: Schema.Int,
  equalInsns: Schema.Int,
  compilerOk: Schema.Boolean,
  diagnostics: Schema.String,
  toolchainDigest: Schema.String,
  canonicalSha256: Schema.String,
  // Required: a matchd that cannot run the inline-assembly check (audit
  // A-032) gives a result this schema refuses, so the job fails closed.
  usesInlineAsm: Schema.Boolean
})

export type MatchJobResult = typeof MatchJobResult.Type

export const LinkJobRequest = Schema.Struct({
  jobId: Schema.String,
  arch: Schema.String,
  language: SourceLanguage,
  toolchain: Schema.Struct({
    compiler: Schema.String,
    version: Schema.String,
    flags: Schema.Array(Schema.String),
    image: Schema.String
  }),
  flags: Schema.optionalKey(Schema.Array(Schema.String)),
  expectedToolchainDigest: Schema.optionalKey(Schema.String),
  headers: Schema.String,
  units: Schema.Array(Schema.Struct({
    symbol: Schema.String,
    address: Schema.String,
    size: Schema.Int,
    originalBytesBase64: Schema.String,
    source: Schema.String,
    allowInlineAsm: Schema.optionalKey(Schema.Boolean)
  }))
})

export type LinkJobRequest = typeof LinkJobRequest.Type

export const LinkJobResult = Schema.Struct({
  jobId: Schema.String,
  compilerOk: Schema.Boolean,
  diagnostics: Schema.String,
  toolchainDigest: Schema.String,
  units: Schema.Array(Schema.Struct({
    symbol: Schema.String,
    passed: Schema.Boolean,
    detail: Schema.String
  }))
})

export type LinkJobResult = typeof LinkJobResult.Type

export class MatchdClient extends Context.Service<
  MatchdClient,
  {
    readonly runJob: (
      job: MatchJobRequest
    ) => Effect.Effect<MatchJobResult, Error>
    readonly runLink: (
      job: LinkJobRequest
    ) => Effect.Effect<LinkJobResult, Error>
  }
>()("rehydra/services/MatchdClient") {
  static readonly layer = Layer.effect(
    MatchdClient,
    Effect.gen(function*() {
      const pool = yield* MatchdPool
      const token = yield* loadMatchdToken
      const http = yield* HttpClient.HttpClient

      const client = http.pipe(
        HttpClient.mapRequest(
          flow(
            HttpClientRequest.bearerToken(Redacted.value(token)),
            HttpClientRequest.acceptJson,
            HttpClientRequest.setHeader("content-type", "application/json")
          )
        )
      )

      const post = Effect.fn("MatchdClient.post")(function*(
        image: string,
        path: string,
        body: unknown
      ) {
        const baseUrl = yield* pool.acquire(image)
        return yield* Effect.gen(function*() {
          const request = HttpClientRequest.post(`${baseUrl}${path}`).pipe(
            HttpClientRequest.bodyJsonUnsafe(body)
          )
          const response = yield* client.execute(request).pipe(
            Effect.mapError((err) => new Error(`matchd request to ${baseUrl} failed: ${String(err)}`))
          )
          if (response.status < 200 || response.status >= 300) {
            const text = yield* response.text.pipe(
              Effect.orElseSucceed(() => "")
            )
            return yield* Effect.fail(
              new Error(`matchd HTTP ${response.status}: ${text}`)
            )
          }
          return response
        }).pipe(Effect.ensuring(pool.release(baseUrl)))
      })

      const runJob = Effect.fn("MatchdClient.runJob")(function*(
        job: MatchJobRequest
      ) {
        const response = yield* post(job.toolchain.image, "/v1/jobs", job)
        return yield* HttpClientResponse.schemaBodyJson(MatchJobResult)(response).pipe(
          Effect.mapError((err) => new Error(`matchd decode failed: ${String(err)}`))
        )
      })

      const runLink = Effect.fn("MatchdClient.runLink")(function*(
        job: LinkJobRequest
      ) {
        const response = yield* post(job.toolchain.image, "/v1/link-jobs", job)
        return yield* HttpClientResponse.schemaBodyJson(LinkJobResult)(response).pipe(
          Effect.mapError((err) => new Error(`matchd decode failed: ${String(err)}`))
        )
      })

      return MatchdClient.of({ runJob, runLink })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
