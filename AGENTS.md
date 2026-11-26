# Agent notes for re-hydra

## Start here

1. **`docs/roadmap.md`** — what is built, compilers, capacity, next work (read first in a new chat)
2. `docs/architecture.md` — how the system runs today, the product rules, and the later multi-site design
3. `docs/db-schema/schema.md` — Postgres schema of record; `schema-reasoning.md` beside it says why
4. `docs/foundations-plan.md` — early decisions being revisited; the next items of work come from here

`README.md` has the workspace layout, the full list of docs, and first-time setup. Policy drafts are in `docs/policy/` (the web shows them, so they are user-facing text). The 2026-11 audit is in `docs/audit/`.

## Effect (required reading)

This project uses **Effect 4**. Before writing or changing Effect code:

1. Read `repos/effect/LLMS.md`
2. Prefer patterns and examples from `repos/effect/` (especially `repos/effect/ai-docs/` and tests) over web search or guessed APIs
3. Do **not** edit files under `repos/` unless explicitly asked
4. Do **not** import from `repos/` — application code imports from `effect`, `@effect/platform-node`, `@effect/sql-pg`, etc.

### Effect style for this repo

- Prefer `Effect.gen` for inline code; prefer `Effect.fn("Name")` / `Effect.fnUntraced` for reusable Effect functions (avoid functions that only wrap `Effect.gen`)
- Define domain errors with `Schema.TaggedError`
- Prefer `Context.Service` + `Layer` for services; put a static `layer` on the service class when practical
- Prefer `Schema` for all validation/parsing (no ad-hoc predicates for untrusted input)
- Prefer `HttpApi` / `HttpApiBuilder` for HTTP surface area
- Prefer `effect/sql` + `@effect/sql-pg` for database access
- Keep the feedback loop tight: run `npm run typecheck` (Effect-patched `tsc` via `@effect/tsgo`) after Effect changes
- Editor: workspace TypeScript SDK + Effect language service (`@effect/language-service` via `@effect/tsgo`). Prefer the workspace TS server / tsgo when Cursor offers it

### Effect patterns

Distilled from `repos/effect/LLMS.md`; the vendored tree wins when they disagree.

```ts
import { Context, Effect, Layer, Schema } from "effect"

// Inline work
const program = Effect.gen(function*() {
  yield* Effect.log("starting")
  return yield* new SomeError({ message: "boom" }) // always `return yield*` on error exits
})

// Reusable functions: do not wrap Effect.gen in a plain function
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

// Services: Context.Service with a static layer
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

**Schema.** Use it for all untrusted input (HTTP payloads, env parsing where applicable). Prefer `Schema.Struct`, `Schema.Class`, `Schema.TaggedError` over manual parsing. For deeper idioms, read `repos/effect/packages/effect/SCHEMA.md` in chunks.

**HTTP.** Define routes with `HttpApi` / `HttpApiGroup` / `HttpApiEndpoint` in `apps/api/src/Api.ts`; implement with `HttpApiBuilder.group`; serve with `HttpRouter.serve` + `NodeHttpServer.layer`; keep OpenAPI via `HttpApiScalar.layer`. Errors the client sees are `HttpApiError.Problem` classes in `apps/api/src/domain/Problems.ts`, with a `reason` where the client must tell cases apart. New endpoints are closed to work-scoped tokens unless annotated `AllowWorkToken`.

### SQL / migrations pitfalls

- Use `SqlClient` from `effect/sql` and `PgClient.layer` / `layerConfig` from `@effect/sql-pg`. Migrations go through `PgMigrator` + `Migrator.fromRecord` (register each in `apps/api/src/db/migrate.ts`).
- `@effect/sql-pg` uses the extended query protocol → **one SQL statement per call** (`cannot insert multiple commands into a prepared statement`). Multi-statement DDL must go through `apps/api/src/db/execSqlScript.ts`.
- Exclusive checkout stays a single conditional `UPDATE ... RETURNING` on `chunks`.
- After any chunk state change, call `ProjectChunkStats.refresh(projectId)` so the project board counts stay correct.

## Vendored repositories

External sources live under `repos/` as git subtrees (read-only reference for agents and humans).

| Path | Purpose |
| --- | --- |
| `repos/effect` | Effect source of truth for idiomatic Effect 4 usage |

Update with:

```bash
git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git main --squash
```

## Local commands

First-time setup (Docker, `.env`, migrate, seed) is the quick start in `README.md`. Day to day:

```bash
npm run api                   # http://localhost:3000, OpenAPI at /docs
npm run web                   # http://localhost:5173
npm run matchd                # host compiler; or: docker compose up -d matchd
npm run hydra -- --help
npm run api:migrate           # after pulling a new migration
npm run api:admin -- grant you@example.com   # site admin (/admin); also revoke, list, delete-user
npm run typecheck             # all workspaces; or api:, cli:, matchd:, web:typecheck
npm test                      # unit tests (api, cli, matchd)
npm run verify                # end-to-end scripts on a fresh database (needs postgres; matchd for some)
npm run verify -- --only <name>   # one script; --list shows them
```

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests, the web build, and `npm run verify` on every push to main and every pull request.
