import { Config, Context, Effect, flow, Layer, Redacted, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"

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
  canonicalSha256: Schema.String
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
    source: Schema.String
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
      const baseUrl = yield* Config.String("MATCHD_URL").pipe(
        Config.withDefault("http://127.0.0.1:3001")
      )
      const tokenPlain = yield* Config.String("MATCHD_TOKEN").pipe(
        Config.withDefault("dev-matchd-token")
      )
      const token = Redacted.make(tokenPlain)
      const http = yield* HttpClient.HttpClient

      const client = http.pipe(
        HttpClient.mapRequest(
          flow(
            HttpClientRequest.prependUrl(baseUrl),
            HttpClientRequest.bearerToken(Redacted.value(token)),
            HttpClientRequest.acceptJson,
            HttpClientRequest.setHeader("content-type", "application/json")
          )
        )
      )

      const post = Effect.fn("MatchdClient.post")(function*(
        path: string,
        body: unknown
      ) {
        const request = HttpClientRequest.post(path).pipe(
          HttpClientRequest.bodyJsonUnsafe(body)
        )
        const response = yield* client.execute(request).pipe(
          Effect.mapError((err) => new Error(`matchd request failed: ${String(err)}`))
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
      })

      const runJob = Effect.fn("MatchdClient.runJob")(function*(
        job: MatchJobRequest
      ) {
        const response = yield* post("/v1/jobs", job)
        return yield* HttpClientResponse.schemaBodyJson(MatchJobResult)(response).pipe(
          Effect.mapError((err) => new Error(`matchd decode failed: ${String(err)}`))
        )
      })

      const runLink = Effect.fn("MatchdClient.runLink")(function*(
        job: LinkJobRequest
      ) {
        const response = yield* post("/v1/link-jobs", job)
        return yield* HttpClientResponse.schemaBodyJson(LinkJobResult)(response).pipe(
          Effect.mapError((err) => new Error(`matchd decode failed: ${String(err)}`))
        )
      })

      return MatchdClient.of({ runJob, runLink })
    })
  ).pipe(Layer.provide(FetchHttpClient.layer))
}
