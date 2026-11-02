# Effect patterns for re-hydra

Distilled from `repos/effect/LLMS.md`. Prefer the vendored Effect tree when unsure.

## Effects

```ts
import { Effect, Schema } from "effect"

// Inline work
const program = Effect.gen(function*() {
  yield* Effect.log("starting")
  return yield* new SomeError({ message: "boom" }) // always `return yield*` on error exits
})

// Reusable functions — do not wrap Effect.gen in a plain function
export const loadChunk = Effect.fn("loadChunk")(function*(id: string) {
  yield* Effect.logInfo("loading", id)
  return id
})

export const validateSize = Effect.fnUntraced(function*(size: number) {
  if (!Number.isInteger(size) || size <= 0) {
    return yield* new SomeError({ message: "invalid size" })
  }
  return size
})

export class SomeError extends Schema.TaggedError<SomeError>()("SomeError", {
  message: Schema.String
}) {}
```

## Services

```ts
import { Context, Effect, Layer, Schema } from "effect"

export class ChunksRepo extends Context.Service<ChunksRepo, {
  get(id: string): Effect.Effect<unknown, ChunksRepoError>
}>()("rehydra/services/ChunksRepo") {
  static readonly layer = Layer.effect(
    ChunksRepo,
    Effect.gen(function*() {
      const get = Effect.fn("ChunksRepo.get")(function*(id: string) {
        return { id }
      })
      return ChunksRepo.of({ get })
    })
  )
}

export class ChunksRepoError extends Schema.TaggedError<ChunksRepoError>()(
  "ChunksRepoError",
  { cause: Schema.Defect() }
) {}
```

## Schema

- Use `Schema` for all untrusted input (HTTP payloads, env parsing where applicable)
- Prefer `Schema.Struct`, `Schema.Class`, `Schema.TaggedError` over manual parsing
- For deeper Schema idioms, read `repos/effect/packages/effect/SCHEMA.md` in chunks

## HTTP

- Define routes with `HttpApi` / `HttpApiGroup` / `HttpApiEndpoint`
- Implement with `HttpApiBuilder.group`
- Serve with `HttpRouter.serve` + `NodeHttpServer.layer`
- Keep OpenAPI via `HttpApiScalar.layer`

## SQL

- Use `SqlClient` from `effect/sql` and `PgClient.layer` / `layerConfig` from `@effect/sql-pg`
- Migrations via `PgMigrator` + `Migrator.fromRecord`
- Exclusive checkout stays a single conditional `UPDATE ... RETURNING` on `chunks`
- **Multi-statement DDL fails** under the extended query protocol (`cannot insert multiple commands into a prepared statement`). Use `apps/api/src/db/execSqlScript.ts` for migration scripts
- Keep `project_chunk_stats` in sync via `ProjectChunkStats.refresh(projectId)` after any chunk state change
