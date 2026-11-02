import { Schema } from "effect"

export const Toolchain = Schema.Struct({
  compiler: Schema.String,
  version: Schema.String,
  flags: Schema.Array(Schema.String),
  image: Schema.String
}).annotate({ identifier: "MatchdToolchain" })

export const SourceFile = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1)),
  text: Schema.String
}).annotate({ identifier: "MatchdSourceFile" })

export const SourceLanguage = Schema.Literals(["c", "cpp"]).annotate({
  identifier: "MatchdSourceLanguage"
})

export const MatchJobRequest = Schema.Struct({
  jobId: Schema.String,
  arch: Schema.String,
  language: Schema.optionalKey(SourceLanguage),
  toolchain: Toolchain,
  flags: Schema.optionalKey(Schema.Array(Schema.String)),
  expectedToolchainDigest: Schema.optionalKey(Schema.String),
  entrySymbol: Schema.String.check(Schema.isMinLength(1)),
  originalBytesBase64: Schema.String.check(Schema.isMinLength(1)),
  sources: Schema.Array(SourceFile).check(Schema.isMinLength(1))
}).annotate({ identifier: "MatchJobRequest" })

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
}).annotate({ identifier: "MatchJobResult" })

export type MatchJobResult = typeof MatchJobResult.Type

export const MatchJobAccepted = MatchJobResult

export const LinkUnit = Schema.Struct({
  symbol: Schema.String.check(Schema.isMinLength(1)),
  address: Schema.String.check(Schema.isMinLength(1)),
  size: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  originalBytesBase64: Schema.String.check(Schema.isMinLength(1)),
  source: Schema.String
}).annotate({ identifier: "LinkUnit" })

export const LinkJobRequest = Schema.Struct({
  jobId: Schema.String,
  arch: Schema.String,
  language: SourceLanguage,
  toolchain: Toolchain,
  flags: Schema.optionalKey(Schema.Array(Schema.String)),
  expectedToolchainDigest: Schema.optionalKey(Schema.String),
  headers: Schema.String,
  units: Schema.Array(LinkUnit).check(Schema.isMinLength(1))
}).annotate({ identifier: "LinkJobRequest" })

export type LinkJobRequest = typeof LinkJobRequest.Type

export const LinkUnitResult = Schema.Struct({
  symbol: Schema.String,
  passed: Schema.Boolean,
  detail: Schema.String
}).annotate({ identifier: "LinkUnitResult" })

export const LinkJobResult = Schema.Struct({
  jobId: Schema.String,
  compilerOk: Schema.Boolean,
  diagnostics: Schema.String,
  toolchainDigest: Schema.String,
  units: Schema.Array(LinkUnitResult)
}).annotate({ identifier: "LinkJobResult" })

export type LinkJobResult = typeof LinkJobResult.Type
