# Implementation status (handoff)

Last updated: 2026-11-01. Read this first in a new chat, then product docs under `docs/` and `AGENTS.md`.

## Verdict

**Milestone 1 is done** end to end (API + matchd + CLI + web), including profiles, attempt history, maintainer clear, and auto-heartbeat.

**Milestone 2 is done** in the API and the web: type proposals, revalidation, unresolved marks, and fuse.

**Contributor ergonomics after M2 are done:** bundle download as a zip, match diagnostics (compile error or instruction diff), and a real `gcc -O2` sample project. `hydra submit` waits for the match result.

**Milestone 3 is done** in the API and the web: follows, a per-project activity stream, people search, reputation, and an optional competing-lease cap (default 1).

**Milestone 4 is done** in the API, matchd, and the web: an integration build links matched functions and compares bytes at their original addresses, and a miss reopens that chunk. The owner can pin C or C++. Isolated normalized match is still the checkout success state.

Multi-region (`architecture.md`) is design-only. Local deploy is single-writer Postgres + local matchd.

## Apps

| App | Path | Role |
| --- | --- | --- |
| API | `apps/api` | Effect 4 HttpApi, Postgres, match worker, lease sweeper |
| matchd | `apps/matchd` | gcc/objdump compile + normalized compare (service token) |
| CLI | `apps/cli` | `hydra` login / checkout / submit / heartbeat / release |
| web | `apps/web` | Vite React + Tailwind v4 + shadcn-style UI |

## What works (dogfooded)

Loop verified locally: `docker compose up` → migrate → seed → magic-link login → checkout → submit → matchd → `matched` (score 1) on the `demo` fixture.

Also verified:

- Public profile, attempt list, membership, maintainer `clear`, web auto-heartbeat (5m)
- Type proposal create + revalidate. One owner or maintainer lands it while the project has one privileged member. Two or more leaves the proposal `ready` until a different owner or maintainer accepts. Unresolved mark + clear
- Fuse of two open chunks into one lease; members leave the board
- Bundle zip download, compile-failure diagnostics, side-by-side miss diff
- `sample` project: three real functions, `Header` type refs, callee links on `parse_header`
- Milestone 3: project search (`q` / language / arch), people search, follow and unfollow, per-project activity, home follow feed, reputation on the profile
- Competing leases: with `demo` cap at 2, two sessions checked out `parse_header` at once (count 2). Releasing the extra holder left the primary lease. Releasing the primary returned the chunk to `open`. Cap was set back to 1
- Milestone 4: `link` / `leaf` and `caller` matched in isolation (score 1) and again at `0x401000` and `0x401040`. `decoy` matched in isolation, then the integration build reopened it (`stale`) because the call displacement disagrees. Checkout of that stale chunk succeeded and the editor was filled from the best attempt. `demo` was pinned to C++ (`g++`) and restored to C (`gcc`). A direct matchd job compiled `int leaf(int x)` as C++ and matched the mangled symbol

## Seed projects

| Slug | What it is |
| --- | --- |
| `demo` | One chunk, `parse_header`, bytes are a single `ret` (`0xc3`). Empty `void parse_header(void) {}` under `-O2` can match. Keep this fixture. |
| `sample` | From `fixtures/sample/export.json`. `skip_space`, `header_size`, `parse_header` compiled together with `gcc -O2` in the matchd image. Shared `Header`. `parse_header` calls the other two. |
| `link` | From `fixtures/link/export.json`. `leaf` and `caller` were linked at `0x401000` and `0x401040`. `decoy` has the same source shape as `caller`, but its stored bytes are `caller`'s, so isolation can match and the integration build reopens it. Rebuild with `node fixtures/link/build.mjs`. |

`npm run api:seed` inserts `sample` only when that slug is missing. Rebuild the JSON with `node fixtures/sample/build.mjs` (needs the `re-hydra-matchd` image) after editing `fixtures/sample/funcs.c`.

**Do not expect an isolated resubmit of `sample`/`parse_header` to match.** Those bytes were produced by compiling all three functions in one translation unit. An isolated candidate emits a different prologue. `skip_space` and `header_size` are the leaves.

## Local database leftovers

This checkout’s Postgres already has dogfood data. It is not required for a fresh seed:

- `demo` is past type revision 2. Proposals titled “Solo review check”, “Two reviewer check”, “Browser solo check”, and “Browser two reviewers” landed while checking the review rule. The current headers still include `/* two reviewers */`. `Second` is not a member of `demo`. The unresolved mark on `Header` was cleared.
- `demo` / `parse_header` (`50e8512a-58d2-47d0-9076-a0f0bf57198d`) is `open`. Its activity lists a cap change to 2, two checkouts, two releases, then the cap restored to 1. `max_concurrent_leases` is 1.
- Users include `Dev User`, `Dogfood`, and `Second` (`second@re-hydra.local`). `Dev User` follows `Second` and does not follow `demo`.
- `fuse-check` is a throwaway project. Chunks `alpha` and `beta` were fused into `combined`.
- `sample` / `parse_header` has two finished non-matches (a compile error, then score 0). The lease was released.
- `link`: `leaf` and `caller` are `matched`. The first integration failed and reopened `decoy` (`mismatch at 0x401085`). A later integration of the two surviving matches passed. `decoy` stays `stale`: release and expiry no longer return an invalidated match to `open`. `decoy`'s language override was set to C++ and then cleared.
- `demo` language is `c` and the compiler is `gcc`. Activity includes a pin to C++ and the restore, from the Milestone 4 check. No matches were reopened.

## Local runbook

```bash
# Docker Desktop must be running
docker compose up -d          # postgres :5432 + matchd :3001
cp apps/api/.env.example apps/api/.env   # if missing
npm install
npm run api:migrate
npm run api:seed              # prints Bearer session + demo chunk id
npm run api                   # :3000
npm run web                   # :5173, proxies /v1 → :3000
```

- API health: http://localhost:3000/v1/health
- API OpenAPI: http://localhost:3000/docs
- matchd health: http://localhost:3001/v1/health
- Web: http://localhost:5173 — login uses `AUTH_EXPOSE_DEV_TOKEN=true` so the magic-link response includes `devToken`

Env (`apps/api/.env`): see `.env.example` (`DATABASE_URL`, `AUTH_EXPOSE_DEV_TOKEN`, `MATCHD_URL`, `MATCHD_TOKEN`).

## Milestone checklist

### Milestone 1 — claim, translate, prove — done

- [x] Magic-link auth → bearer sessions
- [x] Public projects; roles owner / maintainer / contributor
- [x] Ghidra export import
- [x] Exclusive lease, heartbeat, expiry sweeper, overlap rejection
- [x] Maintainer clear of `leased` (not `validating`)
- [x] Project directory + board with live stats
- [x] User profile (`GET /v1/users/:userId`) with matched chunks + maintained projects
- [x] Attempt history on chunk (`GET .../attempts`)
- [x] Web: login, projects, board, checkout/submit, attempt history, clear lease, auto-heartbeat (5m)
- [x] CLI: login, checkout, submit, heartbeat, release
- [x] matchd normalized byte match + stored proof. The compare blanks relocation fields and keeps opcode bytes (`apps/matchd/src/normalize.ts`)
- [x] Best prior attempt attached on next bundle

### Milestone 2 — shared types — done

- [x] Type revisions + proposals + revalidation jobs via matchd
- [x] Failures → `stale`; survivors repinned. The proposal still lands.
- [x] Fuse chunks (members stay as rows with `fuse_parent_id`, hidden from the board)
- [x] Unresolved-type marks → `blocked` on open/stale chunks that reference the type
- [x] Web: `/projects/:slug/types`, `/projects/:slug/type-proposals/:id`, fuse checkboxes on the board

### Contributor ergonomics — done

- [x] Web **Download bundle** while leased. Zip matches `hydra checkout` files (`candidate.c`, `types.h`, `pseudocode.c`, `disassembly.s`, `original.bin`, `neighbors.json`, `chunk.json`, plus `attempt.c` when a best attempt exists). No lease token in the zip.
- [x] Web waits for the match, then shows compiler output or a side-by-side canonical diff. Attempt history can open the same view.
- [x] `hydra submit` polls until the attempt finishes and prints diagnostics.
- [x] `sample` seed project (see above)

### Milestone 3 — directory depth — done

- [x] Per-project activity stream (`project_events`) for checkout, release, expiry, clear, match, miss, import, proposals, fuse, unresolved marks, and the lease cap
- [x] Follow a project or a person. `GET /v1/feed` is activity from those follows
- [x] Project search by name, language, and architecture. People search by display name
- [x] Reputation = current matches minus chunks a proposal you authored sent stale (`proposal_regressions`). Shown on the profile and in search
- [x] `projects.max_concurrent_leases` (1–8, default 1). Above 1, extra holders live in `chunk_leases`. One submission is `validating` at a time. A match releases the other holders. The primary lease stays on the chunk row, so the default path is unchanged

### Milestone 4 — integration build — done

- [x] Link matched functions in one binary and compare the linked bytes with the original bytes at each chunk's address. Needs at least two matched chunks. Mixed languages are linked one language at a time
- [x] A miss invalidates that match and sets the chunk `stale` (best attempt kept). A compile or link failure of the whole job does not reopen chunks
- [x] `stale` chunks can be checked out again, same as `open`
- [x] Owner/maintainer can pin project language `c` or `cpp` and replace flags. A real change recompiles current matches; misses go `stale`. C++ selects `g++` and `candidate.cpp`
- [x] Per-chunk language override. A matched chunk is rechecked under the new language
- [x] Web: recipe form, integration card with per-chunk diff, chunk language override

## Web routes

| Path | Page |
| --- | --- |
| `/` | Home. Signed-in users also see the follow feed |
| `/projects` | Project list, filterable by name, language, and architecture |
| `/people` | Display-name search with reputation |
| `/projects/:slug` | Board, stats, type rev, activity, follow, fuse, lease cap, compiler recipe, integration build |
| `/projects/:slug/types` | Current headers, proposals, unresolved marks, open a proposal |
| `/projects/:slug/type-proposals/:id` | Revalidation progress. An owner or maintainer starts it. A second one accepts when the project has two or more |
| `/projects/:slug/chunks/:id` | Checkout, submit, bundle download, diagnostics |
| `/users/:userId` | Public profile |

Roles: any member can open a proposal. Owner or maintainer starts revalidation. Accept is a second action once the project has two or more owners or maintainers, counted at accept time. The starter cannot accept in that case. One privileged member still lands the proposal from the start action. The same roles mark or clear unresolved types, and fuse. Fuse accepts `open`, `stale`, and `matched` only, and only chunks from one binary. A matched member loses its match.

## API surface added after Milestone 1

| Method | Path | Auth |
| --- | --- | --- |
| GET | `/v1/projects/:slug/type-environment` | no — revision, header text, type names from `chunk_type_refs` |
| GET | `/v1/projects/:slug/type-proposals` | no — list omits header text |
| GET | `/v1/projects/:slug/type-proposals/:id` | no — includes `headers` |
| POST | `/v1/projects/:slug/type-proposals` | member; full replacement headers |
| POST | `/v1/projects/:slug/type-proposals/:id/revalidate` | owner/maintainer. Lands immediately when that project has one privileged member |
| POST | `/v1/projects/:slug/type-proposals/:id/accept` | owner/maintainer, and not the person who started revalidation when two or more remain |
| GET | `/v1/projects/:slug/unresolved-types` | no — active marks only |
| POST | `/v1/projects/:slug/unresolved-types` | owner/maintainer |
| POST | `/v1/projects/:slug/unresolved-types/:name/clear` | owner/maintainer |
| POST | `/v1/projects/:slug/fuse` | owner/maintainer; `{ chunkIds, name? }` |
| GET | `/v1/projects/:slug/activity` | no |
| GET/POST/DELETE | `/v1/projects/:slug/follow` | bearer for all three |
| PATCH | `/v1/projects/:slug/settings` | owner/maintainer. `maxConcurrentLeases`, and/or `language` (`c` \| `cpp`), and/or `flags`. A language or flag change queues recipe rechecks |
| GET | `/v1/users?q=` | no — display name, with reputation |
| GET/POST/DELETE | `/v1/users/:userId/follow` | bearer for all three |
| GET | `/v1/feed` | bearer — followed projects and people |
| PUT | `/v1/projects/:slug/chunks/:id/language` | owner/maintainer. `{ "language": "c" \| "cpp" \| null }` clears with null |
| GET | `/v1/projects/:slug/integrations` | no — newest first, with per-chunk pass/fail and the byte diff |
| GET | `/v1/projects/:slug/integrations/:id` | no |
| POST | `/v1/projects/:slug/integrations` | owner/maintainer. `{ binaryId?, language? }` |

Full table: `apps/api/README.md`. Declarative source: `apps/api/src/Api.ts`.

There is still no GET for one attempt. The web and CLI poll `GET .../attempts` until `finishedAt` is set.

## Where the recent code lives

- Activity writes: `apps/api/src/services/Activity.ts` (service; do not call a free function that still requires `SqlClient`)
- Follows, feed, people search: `apps/api/src/services/DirectoryRepo.ts`
- Competing leases: `chunk_leases` in `apps/api/src/services/ChunksRepo.ts`; side-holder submit in `AttemptsRepo.ts`; expiry promotion in `LeaseSweeper.ts`
- Migration: `apps/api/src/db/migrations/005_milestone3_directory.ts`
- Integration builds: `apps/api/src/services/IntegrationsRepo.ts`, `apps/api/src/services/IntegrationWorker.ts`. matchd `POST /v1/link-jobs` in `apps/matchd/src/link.ts`
- Recipe rechecks when language or flags change: `recipe_jobs`, `apps/api/src/services/RecipeJobs.ts`, claimed from `MatchWorker.ts`
- Migration: `apps/api/src/db/migrations/006_milestone4_integration.ts`
- Web: `apps/web/src/pages/people.tsx`, `apps/web/src/pages/project.tsx`, `apps/web/src/components/activity-list.tsx`, `apps/web/src/components/follow-button.tsx`
- Types UI: `apps/web/src/pages/types.tsx`, `apps/web/src/pages/proposal.tsx`
- Bundle zip: `apps/web/src/lib/bundleFiles.ts`, `apps/web/src/lib/zipStore.ts` (store method, no compression)
- Diagnostics: `apps/web/src/lib/diagnostics.ts`, `apps/web/src/components/diagnostics.tsx`
- Sample seed: `apps/api/src/db/seed.ts` reads `fixtures/sample/export.json`
- Fuse id list: `apps/api/src/services/FuseRepo.ts` casts `ANY(${ids}::uuid[])`. A text array comparison 500s.

The CLI has no Milestone 3 or 4 commands. Follow, search, the lease cap, language, and integration builds are API + web.

## Implementation notes for agents

1. **Migrations** — `@effect/sql-pg` extended queries reject multi-statement strings. Use `apps/api/src/db/execSqlScript.ts` (splits on `;`). Migrations live under `apps/api/src/db/migrations/`.
2. **Project stats** — `project_chunk_stats` is denormalized. Refresh via `ProjectChunkStats.refresh` on every chunk state transition (checkout, release, submit, match worker, clear, sweeper, import, fuse, unresolved, integration reopen, recipe miss). Do not update counts ad hoc.
3. **Seed match fixture** — empty function under `-O2` is typically `ret` only. Keep `demo` bytes aligned with real gcc output or dogfood submit will miss.
4. **Effect 4** — follow `AGENTS.md` + `repos/effect/LLMS.md`. Prefer `Effect.fn` for reusable functions; `Context.Service` + `Layer`; `Schema.TaggedError`.
5. **Web** — Vite proxies `/v1` → API. Session + lease tokens in `localStorage`. Path alias `@/` (no `baseUrl` — TS 7 removed it). Membership loads after auth is ready; privileged forms wait on `useMembership().ready`.
6. **Stale chunks** — A chunk with an invalidated match stays `stale` after release, expiry, and a cleared lease. Checkout still leases it. The matched count ignores it. Migration `007_stale_pool` puts rows that release had left `open` back into `stale`. The project page lists every integration build, not only the newest.
7. **matchd** — Prefer the Docker image (gcc, g++, binutils). Host `npm run matchd` needs those tools on PATH. Language `cpp` compiles `candidate.cpp` with `g++` and resolves Itanium-mangled symbols back to the chunk name. An isolated match compares machine code with relocation fields blanked (`npm run test -w @re-hydra/matchd`). It does not rewrite mnemonics. The toolchain digest is `sha256:v2:<cc1 or cc1plus>:<as>:<recipe>`. A recheck or a link that carries a v2 digest refuses to compile when `cc1`/`cc1plus` or `as` differ. Older `sha256:` rows are not pins; the next successful recheck stores v2. A compiler failure on revalidation fails the job and leaves the match in place. The worker polls about every 2 seconds. An integration build is `POST /v1/link-jobs`: each matched source is compiled on its own, then `ld` places `.text.<symbol>` at the chunk address. The section length has to equal the chunk. A longer section fails, including when the chunk is a prefix of it. Units proved with different compiler pins stop the build.
8. **UUID arrays** — `id = ANY($1)` fails when the driver binds `text[]`. Cast to `uuid[]`.
9. **Competing leases** — default `max_concurrent_leases` is 1 and checkout is still one conditional update on `chunks`. Above 1, extra holders are rows in `chunk_leases`. Submit from an extra holder moves that token onto the chunk and parks the previous primary in `chunk_leases`, because `validating` is still one row. A miss keeps the submitter as primary. A match calls `releaseSideLeases`.
10. **Reputation** — not a table. Count matches that are still `chunks.current_match_id`, then subtract `proposal_regressions` written when revalidation sends a chunk stale.
11. **Type proposals** — `ready` means revalidation finished and a second owner or maintainer must accept. `revalidation_started_by` is who started it. `reviewed_by` is who accepted. The revision's `created_by` stays the proposal author. Membership is read when the proposal lands, not when it was opened.

## Recommended next work

Milestones 1–4 are in place. Multi-region stays design-only. This product question is still open:

- What happens to member matches if a fused chunk is later split (split is not implemented)

## Known gaps / non-goals still open

- No automated test suite for the loop yet
- Blob storage is local `blob_objects` (not S3)
- matchd runs host/docker gcc. The match digest pins `cc1`/`cc1plus` and `as` on that machine. A registry image digest is still the multi-region plan, not what a local match records
- Multi-region is unimplemented (single local writer)
- No web UI for Ghidra import; owners POST the JSON (`apps/api/README.md`)
- CLI does not follow, search, change `max_concurrent_leases`, pin language, or start an integration build
- One compiler image still hosts both gcc and g++. A C match pins `cc1`, a C++ match pins `cc1plus`
- Integration links each matched function as its own translation unit. It does not search for a layout or a compiler flag set
- Profile follower count does not refresh until the page reloads after a follow
