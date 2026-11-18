import { Schema } from "effect"
import { HttpApiError, HttpApiSchema } from "effect/http-api"
import { Toolchain } from "./Project.js"
import { Uuid } from "./Uuid.js"

export const ImportFunction = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1)),
  address: Schema.String.check(Schema.isMinLength(1)),
  size: Schema.Int.check(Schema.isGreaterThan(0)),
  bytesBase64: Schema.String.check(Schema.isMinLength(1)),
  pseudocode: Schema.String,
  disassembly: Schema.String,
  callees: Schema.optionalKey(Schema.Array(Schema.String)),
  typesUsed: Schema.optionalKey(Schema.Array(Schema.String))
}).annotate({ identifier: "ImportFunction" })

export type ImportFunction = typeof ImportFunction.Type

export const GhidraExportPayload = Schema.Struct({
  binarySha256: Schema.String.check(Schema.isMinLength(64)).check(
    Schema.isMaxLength(64)
  ),
  arch: Schema.String.check(Schema.isMinLength(1)),
  name: Schema.optionalKey(Schema.String),
  language: Schema.optionalKey(Schema.String),
  toolchain: Schema.optionalKey(Toolchain),
  types: Schema.String,
  /** Full binary bytes optional; function bodies are enough for matching. */
  binaryBase64: Schema.optionalKey(Schema.String),
  functions: Schema.Array(ImportFunction).check(Schema.isMinLength(1))
}).annotate({ identifier: "GhidraExportPayload" })

export type GhidraExportPayload = typeof GhidraExportPayload.Type

export const ImportState = Schema.Literals([
  "uploaded",
  "parsing",
  "ready",
  "failed"
]).annotate({ identifier: "ImportState" })

export type ImportState = typeof ImportState.Type

export const ImportResult = Schema.Struct({
  id: Uuid,
  projectId: Uuid,
  binaryId: Uuid,
  state: ImportState,
  functionsTotal: Schema.Int,
  functionsCreated: Schema.Int,
  functionsUpdated: Schema.Int,
  typeRevision: Schema.Int,
  createdAt: Schema.String
}).annotate({ identifier: "ImportResult" })

export type ImportResult = typeof ImportResult.Type

export const ImportAccepted = ImportResult.pipe(HttpApiSchema.status("Created"))

/** A readable reason the export cannot become chunks. */
export class ImportRejected extends HttpApiError.Problem<ImportRejected>()("ImportRejected", {
  type: "https://re-hydra.dev/problems/import-rejected",
  status: 400,
  title: "Export rejected"
}) {}
