import { Schema } from "effect"
import { SourceLanguage, Toolchain } from "./Project.js"
import { Uuid } from "./Uuid.js"

export const IntegrationStatus = Schema.Literals([
  "queued",
  "running",
  "passed",
  "failed",
  "error"
]).annotate({ identifier: "IntegrationStatus" })

export type IntegrationStatus = typeof IntegrationStatus.Type

export const IntegrationUnit = Schema.Struct({
  chunkId: Uuid,
  name: Schema.String,
  address: Schema.String,
  size: Schema.Int,
  passed: Schema.NullOr(Schema.Boolean),
  detail: Schema.String
}).annotate({ identifier: "IntegrationUnit" })

export type IntegrationUnit = typeof IntegrationUnit.Type

export const Integration = Schema.Struct({
  id: Uuid,
  projectId: Uuid,
  binaryId: Uuid,
  status: IntegrationStatus,
  language: SourceLanguage,
  toolchain: Toolchain,
  toolchainDigest: Schema.NullOr(Schema.String),
  summary: Schema.String,
  diagnostics: Schema.NullOr(Schema.String),
  units: Schema.Array(IntegrationUnit),
  createdAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String)
}).annotate({ identifier: "Integration" })

export type Integration = typeof Integration.Type

export const StartIntegration = Schema.Struct({
  binaryId: Schema.optionalKey(Uuid),
  language: Schema.optionalKey(SourceLanguage)
}).annotate({ identifier: "StartIntegration" })

export type StartIntegration = typeof StartIntegration.Type
