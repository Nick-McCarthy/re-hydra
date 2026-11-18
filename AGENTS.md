# Agent notes for re-hydra

## Start here

1. **`docs/roadmap.md`** — what is built, compilers, capacity, next work (read first in a new chat)
2. `docs/architecture.md` — how the system runs today, and the later multi-site design
3. `docs/db-schema/schema.md` — Postgres schema of record
4. `docs/db-schema/schema-reasoning.md` — why the schema is shaped that way

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

### SQL / migrations pitfalls

- `@effect/sql-pg` uses the extended query protocol → **one SQL statement per `sql.unsafe` call**. Multi-statement DDL must go through `apps/api/src/db/execSqlScript.ts`.
- After any chunk state change, call `ProjectChunkStats.refresh(projectId)` so the project board counts stay correct.

Optional project-local pattern notes: `agent-patterns/`.

## Vendored repositories

External sources live under `repos/` as git subtrees (read-only reference for agents and humans).

| Path | Purpose |
| --- | --- |
| `repos/effect` | Effect source of truth for idiomatic Effect 4 usage |

Update with:

```bash
git subtree pull --prefix=repos/effect https://github.com/Effect-TS/effect.git main --squash
```

## Workspace layout

- `apps/api` — Effect HTTP API (start here for backend work)
- `apps/cli` — contributor CLI (`hydra`), typed against `@re-hydra/api` HttpApi
- `apps/matchd` — compile + normalized compare (service-token only)
- `apps/web` — Vite React client (login, profiles, project board, checkout/submit, attempts, auto-heartbeat)
- `docs/` — roadmap, architecture, schema
- `docker-compose.yml` — local Postgres + matchd

## Local commands

```bash
docker compose up -d          # requires Docker Desktop running
npm install
npm run api:migrate
npm run api:seed
npm run matchd                # or: docker compose up -d matchd
npm run api
npm run web
npm run api:typecheck
npm run hydra -- --help
npm run cli:typecheck
npm run matchd:typecheck
npm run web:typecheck
npm run typecheck             # all workspaces
```

## Current milestone focus

- **Done:** Milestones 1–4 (claim/match, types, directory, integration build and C++)
- **Next:** see `docs/roadmap.md`. A second site is design-only. One-site match capacity (route, claimers, sandbox, extra copies) is in place
