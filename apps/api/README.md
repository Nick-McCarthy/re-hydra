# @re-hydra/api

Effect 4 HTTP API for exclusive chunk checkout, matchd-backed normalized matching, and a later integration build that links those matches at their original addresses.

Implementation status: **Milestones 1–4 complete**. See `docs/roadmap.md`.

## Stack

- Effect 4 (`effect`, `effect/http-api`, `effect/sql`)
- `@effect/platform-node` HTTP server
- `@effect/sql-pg` + Postgres 16
- Declarative `HttpApi` (OpenAPI via Scalar at `/docs`)
- Email and password auth → bearer sessions
- Ghidra export import + work bundles on checkout
- Match worker claims jobs and calls `matchd` (compile + normalized compare)

## Local setup

```bash
# from repo root
docker compose up -d
cp apps/api/.env.example apps/api/.env   # if needed
npm install
npm run api:migrate
npm run api:seed
npm run api
```

- API: http://localhost:3000/v1/health
- Docs: http://localhost:3000/docs

Seed prints a session bearer token and sets the local password for `dev@re-hydra.local` to `rehydra-dev`.

## Auth

```bash
curl -s -X POST http://localhost:3000/v1/auth/sign-in \
  -H 'content-type: application/json' \
  -d '{"email":"dev@re-hydra.local","password":"rehydra-dev"}'

curl -s -X POST http://localhost:3000/v1/auth/sign-up \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","displayName":"Ada","password":"a-long-password"}'
```

## Import (owner / maintainer)

```bash
curl -s -X POST http://localhost:3000/v1/projects/demo/imports \
  -H "authorization: Bearer <session>" \
  -H 'content-type: application/json' \
  -d @export.json
```

Export JSON shape (camelCase):

```json
{
  "binarySha256": "<64 hex>",
  "arch": "x86_64",
  "name": "demo.bin",
  "types": "/* headers */",
  "functions": [
    {
      "name": "parse_header",
      "address": "0x401000",
      "size": 6,
      "bytesBase64": "...",
      "pseudocode": "void parse_header(void) {}",
      "disassembly": "parse_header:\n  ret\n",
      "callees": ["0x401200"],
      "typesUsed": ["Header"]
    }
  ]
}
```

Re-import updates open/stale/blocked chunks in place and skips lease/match disruption for leased/validating/matched rows.

`npm run api:seed` also creates project `sample` from `fixtures/sample/export.json` when that slug is missing. Those three functions are real `gcc -O2` output (`fixtures/sample/funcs.c`). Rebuild the JSON with `node fixtures/sample/build.mjs` (needs the `re-hydra-matchd` image).

## Checkout + work bundle

```bash
# returns lease + full work bundle (bytes, pseudocode, types, neighbors, best attempt)
curl -s -X POST http://localhost:3000/v1/projects/demo/chunks/<chunkId>/checkout \
  -H "authorization: Bearer <session>"

# re-fetch bundle while you hold the lease
curl -s http://localhost:3000/v1/projects/demo/chunks/<chunkId>/bundle \
  -H "authorization: Bearer <session>"
```

## Endpoints

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/v1/health` | no |
| POST | `/v1/auth/sign-up` | no |
| POST | `/v1/auth/sign-in` | no |
| POST | `/v1/auth/password` | Bearer session |
| GET | `/v1/auth/me` | Bearer session |
| POST | `/v1/auth/logout` | Bearer session. A profile token is not revoked. |
| POST | `/v1/auth/tokens` | Bearer. Body `{ "label" }`. Returns the secret once. |
| GET | `/v1/auth/tokens` | Bearer. Active tokens, without the secret. |
| DELETE | `/v1/auth/tokens/:tokenId` | Bearer. Revoke one of your tokens. |
| GET | `/v1/users?q=` | no (display-name search with reputation) |
| GET | `/v1/users/:userId` | no (public profile, reputation, matched chunks) |
| GET | `/v1/users/:userId/follow` | Bearer |
| POST | `/v1/users/:userId/follow` | Bearer |
| DELETE | `/v1/users/:userId/follow` | Bearer |
| GET | `/v1/feed` | Bearer (activity from followed projects and people) |
| GET | `/v1/following/users` | Bearer (users you follow) |
| GET | `/v1/following/projects` | Bearer (projects you follow) |
| GET | `/v1/projects?q=&language=&arch=` | no |
| GET | `/v1/projects/:slug` | no |
| GET | `/v1/projects/:slug/activity` | no |
| GET | `/v1/projects/:slug/follow` | Bearer |
| POST | `/v1/projects/:slug/follow` | Bearer |
| DELETE | `/v1/projects/:slug/follow` | Bearer |
| PATCH | `/v1/projects/:slug/settings` | Bearer (owner/maintainer). `{ maxConcurrentLeases?, maxHeldChunks?, language?: "c"\|"cpp", flags? }`. Language or flags recheck current matches |
| PUT | `/v1/projects/:slug/chunks/:chunkId/language` | Bearer (owner/maintainer). `{ "language": "c"\|"cpp"\|null }` |
| GET | `/v1/projects/:slug/integrations` | no |
| GET | `/v1/projects/:slug/integrations/:id` | no |
| POST | `/v1/projects/:slug/integrations` | Bearer (owner/maintainer). `{ binaryId?, language? }` links matched chunks |
| GET | `/v1/projects/:slug/membership` | Bearer session |
| POST | `/v1/projects` | Bearer session |
| POST | `/v1/projects/:slug/imports` | Bearer (owner/maintainer) |
| GET | `/v1/projects/:slug/type-environment` | no |
| GET | `/v1/projects/:slug/type-proposals` | no |
| GET | `/v1/projects/:slug/type-proposals/:id` | no |
| POST | `/v1/projects/:slug/type-proposals` | Bearer (member) |
| POST | `/v1/projects/:slug/type-proposals/:id/revalidate` | Bearer (owner/maintainer) |
| GET | `/v1/projects/:slug/unresolved-types` | no |
| POST | `/v1/projects/:slug/unresolved-types` | Bearer (owner/maintainer) |
| POST | `/v1/projects/:slug/unresolved-types/:name/clear` | Bearer (owner/maintainer) |
| POST | `/v1/projects/:slug/fuse` | Bearer (owner/maintainer) |
| GET | `/v1/projects/:slug/chunks?state=&q=&limit=&offset=` | no. Omit `limit` to return every chunk. |
| GET | `/v1/projects/:slug/chunks/:chunkId` | no |
| GET | `/v1/projects/:slug/chunks/:chunkId/attempts` | no |
| GET | `/v1/projects/:slug/chunks/:chunkId/bundle` | Bearer (lease holder) |
| POST | `/v1/projects/:slug/chunks/:chunkId/checkout` | Bearer |
| POST | `/v1/projects/:slug/chunks/:chunkId/release` | Bearer + `{ "leaseToken" }` |
| POST | `/v1/projects/:slug/chunks/:chunkId/heartbeat` | Bearer + `{ "leaseToken" }` |
| POST | `/v1/projects/:slug/chunks/:chunkId/submit` | Bearer + `{ "leaseToken", "source" }` |
| POST | `/v1/projects/:slug/chunks/:chunkId/clear` | Bearer (owner/maintainer; leased only) |

## matchd

Submit enqueues a `jobs` row. The API process runs `MATCHD_WORKERS` claimers (4 by default). Each claimer takes one queued job, using `FOR UPDATE SKIP LOCKED`, and POSTs it to the matchd that has that job's compiler image. A claimer waits 2 seconds only when it found nothing to do. Worker 0 runs a recipe recheck only when no submit is queued. `MATCHD_URL` (`http://127.0.0.1:3001` by default) is the process for images that are not listed. `MATCHD_ROUTES` is a comma-separated list of `image=url` pairs for the other images. Several copies of one image are `url|url`, and a job goes to the copy with the fewest compiles in flight. `docker-yml/docker-compose.matchd-pool.yml` publishes the warm processes on their own host ports so they can stay up beside the default matchd. When `MATCHD_SCALE=docker` (the default) and an interactive job for an image has waited 30 seconds, the API starts one more local container of that image, up to `MATCHD_SCALE_MAX` (4). The warm process stays up. A copy is removed after that image has been idle for 60 seconds. The queue stays in Postgres.

```bash
docker compose up -d matchd
# or: npm run matchd   # requires host gcc + objdump
```

A full normalized instruction match sets the chunk to `matched`. Misses return diagnostics and keep the lease.

## Milestone 2 — shared types

- **Type environment** — `GET /type-environment` returns the latest revision, header text, and type names referenced by chunks. Proposal get/create include the proposed headers; the list omits them.
- **Type proposals** — create with new headers. `revalidate` enqueues matchd jobs for affected matched chunks. One owner or maintainer lands the revision while the project has one privileged member. Two or more leaves the proposal `ready` until a different owner or maintainer `accept`s. Survivors stay matched under a new revision; failures become `stale` and do not block accept.
- **Unresolved types** — maintainer mark blocks open/stale chunks that reference the type; clear restores them when no other mark applies.
- **Fuse** — maintainer merges 2+ chunks into one covering parent (members keep rows with `fuse_parent_id`).

## Background fibers

- **Match worker** — claim jobs (interactive + revalidation), call matchd, apply results / finalize proposals
- **Lease sweeper** — expire forgotten leases every 30s
