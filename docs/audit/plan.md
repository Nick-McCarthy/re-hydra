# re-hydra audit plan

Status: in progress. Written 2026-11-22 against `main` at `cd2a88feb` with uncommitted edits to `roadmap.md` and `architecture.md`.

## Progress

| Item | State | Where |
| --- | --- | --- |
| Phase 1 — Purpose | Done 2026-11-22 | [phase-1-2.md](phase-1-2.md) |
| Phase 2 — Architecture | Done 2026-11-22 | [phase-1-2.md](phase-1-2.md) |
| Fixes A-001 to A-006 | Done 2026-11-22, merged to `main` locally (`c065901a7`) | [changelog.md](changelog.md) |
| Security fixes A-019, A-020, A-021, A-025 | Done 2026-11-23, merged to `main` locally (`e5aa1b7ed`) | [changelog.md](changelog.md) |
| Housekeeping: merge, rebuild 17 matchd images, recreate containers | Done 2026-11-23. Found A-027 | [changelog.md](changelog.md) |
| A-027 sandbox seccomp profile | Done 2026-11-23, merged to `main` locally (`f5418cf9b`) | [changelog.md](changelog.md), [docker-yml/matchd-seccomp.md](../../docker-yml/matchd-seccomp.md) |
| Phase 3 — Schema | Done 2026-11-23, merged to `main` locally (`d2d49ec21`) | [phase-3.md](phase-3.md) |
| Phase 4 — Security review | Done 2026-11-23 (branch `audit/phase-4-security`) | [phase-4.md](phase-4.md) |
| A-032 and A-041 inline assembly and reputation | Fixed 2026-11-23, pushed to `main` (`8953d8407`) | [changelog.md](changelog.md) |
| A-034 and A-035 body size and rate limits | Fixed 2026-11-23, pushed to `main` (`8953d8407`) | [changelog.md](changelog.md) |
| A-013 flag allow-list and memory cap | Fixed 2026-11-23, pushed to `main` (`8953d8407`) | [changelog.md](changelog.md) |
| A-036 bundle text reaching the agent | Fixed 2026-11-23, pushed to `main` (`0b5b55142`) | [changelog.md](changelog.md) |
| Small fixes A-010, A-014, A-015, A-018, A-026, A-028, A-033, A-038 | Fixed 2026-11-23, pushed to `main` (`6ceea7694`) | [changelog.md](changelog.md) |
| A-007 call targets | Fixed 2026-11-24, pushed to `main` (`6ceea7694`) | [changelog.md](changelog.md) |
| A-037, A-039, A-040 headers, pinned sources, password cost | Fixed 2026-11-24, pushed to `main` (`1ed2ec9bf`) | [changelog.md](changelog.md) |
| A-012 open vs members-only projects, block list | Fixed 2026-11-24, pushed to `main` (`bdeee5e42`) | [changelog.md](changelog.md) |
| A-011 members, roles, ownership transfer | Fixed 2026-11-24, pushed to `main` (`06435a565`) | [changelog.md](changelog.md) |
| Phases 5–8 | Not started | — |

Findings: [findings.md](findings.md). 41 logged, 40 fixed, 1 closed as not applicable (A-024), none open. Phases 5–8 remain.

Invariant status after the fixes:

| Invariant | Before | Now |
| --- | --- | --- |
| I3 one submission `validating` per chunk | Not enforced | Enforced in code and in the database (`jobs_one_active_interactive`, migration 012) |
| I4 result commits only for the live attempt | Partly | Enforced. The lock and lease-token check come before the match insert |
| I8 a retried claim applies once | No | Enforced for interactive, type-recheck, and recipe-recheck jobs |
| I11 a held chunk can always be returned | No for `validating` | Yes: on job failure, plus a sweeper backstop |
| I12 a proposal always finishes | No | Yes. Failed rechecks count as done (A-026 tracks showing them separately) |

The audit runs from the outside in. It starts with what re-hydra promises, then checks whether the design, the schema, the code, and the operations keep those promises. Each phase produces findings in one shared log (format at the end). A later phase can send a finding back to an earlier one, for example a code bug that is really a design gap.

## Scope

| In | Out |
| --- | --- |
| `apps/api`, `apps/matchd`, `apps/cli`, `apps/web` | `repos/` (vendored Effect, read-only reference) |
| Migrations `001`–`011`, seed, `fixtures/` | Retail SDK compilers (not shipped) |
| `docker-yml/`, `compose.yaml`, matchd Dockerfiles | The second site (design-only; audited as design in phase 2) |
| `docs/`, `AGENTS.md`, `README.md` | Ghidra itself, and the owner's export script |

Size, to set effort: API ~10.5k lines, matchd ~5.6k, web ~6.2k, CLI ~0.7k. 2 API test files, 21 matchd test files, none in web or CLI.

## Severity

| Level | Meaning |
| --- | --- |
| Critical | Breaks a core promise: two leases on one chunk, a false match, sandbox escape, account takeover |
| High | Exploitable or data-corrupting under realistic use, or blocks the us-east-1 deploy |
| Medium | Wrong behavior in an edge case, missing guard, operational risk |
| Low | Clarity, drift between docs and code, style against `AGENTS.md` |

## Phase 1 — Purpose and product

Question: is the product well defined, and is it worth building the way it is built?

- Restate the core promise in one paragraph and check every doc agrees: exclusive checkout, local translation, normalized byte match, stored proof. Look for contradictions between `README.md`, `roadmap.md`, `architecture.md`, and the FAQ page (`apps/web/src/pages/faq.tsx`).
- Personas and journeys: owner (import, pin recipe, fuse, clear leases), maintainer, contributor (checkout, translate with their own agent, submit, retry), reviewer of type proposals. Walk each journey end to end and note every step that has no UI or CLI path (known: Ghidra import has no web UI; CLI lacks follow, search, lease cap, language, integration).
- Definition of "done": isolated normalized match is the checkout success, integration is a later build. Decide whether contributors and owners will understand that a matched chunk can still fail integration, and whether the board says so.
- Incentives and abuse: reputation is matches minus `proposal_regressions`. Look for ways to farm it (trivial chunks, `demo`-style empty functions, resubmitting under a fresh lease), and for ways to grief (hoarding leases up to `max_held_chunks`, heartbeating forever up to `max_hold_hours`, spam type proposals).
- Legal and policy: the owner affirms rights to the binary, but there is no written policy on copyrighted software or malware. List what must exist before a public launch (terms, takedown path, malware handling for uploaded bytes, licensing of submitted source).
- Compiler honesty: every registered image is a public stand-in. Check that the UI and the work bundle tell contributors a match proves equivalence to that stand-in, not to the retail SDK.
- Success metrics: what would show the product working (chunks matched per week, time from checkout to match, queue wait). Are any of them measurable today?

Deliverable: a one-page product statement with open product questions and a gap list per persona.

## Phase 2 — Architecture and design

Question: does the design keep the promise under concurrency, failure, and growth?

- Invariants. Turn each product rule and the "Before a second site" list in `architecture.md` into a numbered invariant. Each later phase cites invariants by number.
  - One primary lease per chunk; extra holders only in `chunk_leases` up to `max_concurrent_leases`.
  - One `validating` submission per chunk; a result commits only if the chunk is still `validating` for that attempt.
  - One active match per chunk.
  - Lease expiry uses the database clock; heartbeat never extends past `max_hold_hours`.
  - A match is never recorded under a digest the worker did not compute.
  - Killing matchd mid-compile requeues the job and the later result applies once.
- Trust boundaries. Draw them: browser and CLI → API (session or access token), API → matchd (shared bearer), API → Postgres, API → S3, matchd → compiler inside bwrap, API → local Docker daemon (scaler). Every arrow gets an owner for authn, authz, input validation, and size limits.
- State machine. Draw `chunk_state` transitions (open, leased, validating, matched, stale, blocked, plus fused members) from the code, not the docs, and compare to the `CHECK` constraint on `chunks`. Find any transition the code performs that the docs do not describe.
- Queues and workers. Review the match worker, recipe rechecks, integration worker, lease sweeper, and scaler as one system: claim ordering, starvation (recipe rechecks only when no submit waits), the 2-minute claim expiry vs the 30-second cap, and what happens when two API processes run.
- Normalized match soundness. Ask whether blanking relocation fields at the same offsets in both byte strings can accept a function that is not equivalent (for example a candidate whose relocation targets a different symbol, or an addend difference hidden by the mask). Decide what the proof actually proves and write it down.
- Multi-site design. Review the second-region section as design: replica lag on the board, fallback bucket reads, signed URLs, failover with one sweeper. Look for steps that silently assume one writer, such as the scaler and the sweeper.
- Out-of-scope list. Confirm nothing in the code quietly does what the doc says is out of scope (running uploaded binaries, storing provider keys).

Deliverable: invariant list, trust-boundary diagram, chunk state diagram, and design findings.

## Phase 3 — Data and schema

All data in the current databases is test data, and production starts empty. So migrations here need to apply cleanly to an empty database, but they don't need repair steps for existing rows. A conflicting dev database can be reset.

Question: does Postgres enforce the invariants, or only the application?

- Compare `docs/db-schema/schema.md` to migrations `001`–`011` column by column. Note drift. The reasoning doc says `001`–`008`; three later migrations exist.
- For each invariant from phase 2, record whether a constraint enforces it (CHECK, UNIQUE, partial unique, EXCLUDE gist) or only code. Prefer constraints where the cost is low.
- Exclusion constraint on `addr_range` with fusion: confirm fused members really leave the address space and that a concurrent import plus fuse cannot produce overlap.
- `project_chunk_stats`: list every write path that changes chunk state and confirm each calls `ProjectChunkStats.refresh`. Write a drift check query that rebuilds counts from `chunks` and compares.
- `chunk_leases` and the primary lease: test the swap when an extra holder submits, and the cleanup when a match releases side rows.
- Indexes against the hot queries: board listing, checkout, job claim (`FOR UPDATE SKIP LOCKED` partial index), sweeper scan, directory search. Run `EXPLAIN ANALYZE` on a seeded project scaled to ~100k chunks.
- Migrations: idempotence, ordering, whether any data migration (like `007`) can run twice safely, and whether multi-statement DDL always goes through `execSqlScript.ts`.
- Blobs: `blobs` registry vs bucket contents, orphan objects, `blob_objects` fallback and its planned removal, maximum blob sizes.
- Retention and privacy: emails (`citext`), sessions, access tokens, revoke timestamps, `project_events`. What is kept forever and what should expire.

Deliverable: invariant-to-constraint table, schema drift list, query plans, drift-check SQL.

## Phase 4 — Security

Question: can an outsider or a member break the promises or the host?

### API authn and authz

- Password storage (`apps/api/src/auth/password.ts`): scrypt params, salt, constant-time compare. Sign-up and sign-in rate limiting and lockout (none found yet).
- Sessions and access tokens (`AuthRepo.ts`, `AuthLive.ts`, `AuthorizationLive.ts`): token entropy, hashing at rest, expiry, revoke on password change for sessions, the documented choice that access tokens survive a password change.
- Role checks: for every endpoint in `apps/api/src/Api.ts`, list the required role and confirm the handler enforces it. Focus on import, fuse, clear lease, recipe change, proposal accept (two-person rule when a second privileged member exists), lease cap changes.
- IDOR: every route taking a project, chunk, attempt, proposal, or user id must check membership or visibility, including attempts history and work-bundle download.
- Input limits: request body size, JSON depth, Ghidra import size, source size before it reaches matchd (matchd caps at 256 KiB source and 2 MiB `types.h`; the API should refuse earlier).
- CORS, CSRF (bearer tokens in the web app: where are they stored, is there any cookie auth), security headers.

### matchd and the sandbox

- `MatchdAuth.ts` compares the bearer with `!==`, not a constant-time compare.
- `MATCHD_TOKEN` defaults to `dev-matchd-token` in three places (`MatchdClient.ts`, `MatchdScaler.ts`, `MatchdAuth.ts`). Production must fail to start without a real value.
- `MatchdScaler.ts` passes the token with `-e MATCHD_TOKEN=...` on the `docker run` command line, visible in the host process list and `docker inspect`.
- bwrap policy (`sandbox.ts`, `proc.ts`): no network, read-only toolchain, private temp, 30 s wall and CPU, 32 MiB output. Missing: memory cap, process count cap, disk cap on temp. Try fork bombs, huge `#include` expansion, `#include "/proc/..."`, `__asm__` that emits large sections, and compiler plugins via flags.
- Recipe flags are owner-controlled. Check whether an owner can pass flags that load plugins, write outside temp (`-o`, `-save-temps`, `-specs`), or read host files (`-include`, `@file`).
- Output parsing (`normalize.ts`, `symbols.ts`, `link.ts`): objdump and nm text is parsed with regexes. Fuzz with hostile object files and odd symbol names. Confirm unknown relocations fail closed on every family.
- matchd should not be reachable except from the API. Check published ports in every compose file.

### Scaler and Docker

- The API holds access to the Docker daemon, which is root on the host. Decide whether that is acceptable in production or whether scaling moves to an orchestrator.
- Container names and labels are built from image strings. Confirm only registered image tags reach `docker run`.

### Blobs and S3

- Path-style signing (`s3Object.ts`) vs AWS virtual-host style for the us-east-1 deploy. Check signature correctness, key scoping (put and get on one bucket only), and that hash keys cannot be path-traversed.
- Content type on download, and whether any blob is served to a browser in a way that could render HTML.

### Web and CLI

- XSS from pseudocode, disassembly, diagnostics, profile fields, project names. Look for `dangerouslySetInnerHTML` and unescaped rendering.
- `zipStore.ts`: zip filenames built from server data. Confirm a chunk name cannot write `../` paths on extract.
- CLI config (`apps/cli/src/config.ts`): where the access token is written, file permissions, whether it is ever printed.

### Supply chain

- `npm audit`, lockfile review, pinned base images and compiler downloads in each Dockerfile (checksums, not floating tags). Tag vs digest pinning for matchd images.

Deliverable: threat model (STRIDE per trust boundary) and security findings, each with a reproduction.

## Phase 5 — Code correctness

Question: does each module do what the invariants require?

Review in this order, highest risk first. For each file, trace every SQL statement to an invariant.

1. `apps/api/src/services/ChunksRepo.ts` — checkout conditional update, heartbeat cap, release, maintainer clear, extra holders.
2. `apps/api/src/services/AttemptsRepo.ts` — submit, idempotency on `(chunk_id, lease_token, source_sha256)`, move to `validating`. *Rewritten for A-002 and A-003. Review the new transaction, not the old code.*
3. `apps/api/src/services/MatchWorker.ts` — claim, timeout, result commit only when still `validating`, duplicate results, recipe rechecks, digest checks. *Interactive and type-recheck commits rewritten for A-001, A-004, and A-005. Recipe rechecks are still open (A-022).*
4. `apps/api/src/services/LeaseSweeper.ts` — database clock, interaction with `validating`, stats refresh.
5. `apps/api/src/services/TypeProposalsRepo.ts`, `ProposalAccept.ts` — revalidation counters, two-person accept, membership read at land time.
6. `apps/api/src/services/FuseRepo.ts`, `UnresolvedTypesRepo.ts` — fuse ranges, blocked transitions.
7. `apps/api/src/services/IntegrationWorker.ts`, `IntegrationsRepo.ts` — link at original addresses, reopening a chunk on a miss.
8. `apps/api/src/services/ImportsRepo.ts` — re-import identity, refresh pseudocode without a second claim.
9. `apps/api/src/services/MatchdPool.ts`, `MatchdClient.ts`, `MatchdScaler.ts`, `matchdRoutes`/`matchdScale` — routing, fewest in flight, scale up and down, leaked containers after an API crash.
10. `apps/matchd/src/compile.ts`, `normalize.ts`, `toolchain.ts`, `toolchains/*`, `families/*`, `targets/*` — digest construction (`sha256:v2:`), entry-symbol extraction, COFF sizing by next symbol, per-family relocation widths and endianness.
11. `apps/api/src/services/WorkBundles.ts` — bundle contents match the doc, `integration.txt` when relevant.
12. `apps/cli/src/*`, `apps/web/src/lib/api.ts` and pages — error handling, heartbeat timing, stale UI after conflicts.

Cross-cutting checks:

- Effect style against `AGENTS.md`: `Schema.TaggedError` for domain errors, `Effect.fn` for reusable functions, `Context.Service` + `Layer`, `Schema` for all untrusted input, no imports from `repos/`.
- Error mapping: every domain error reaches the client as the right HTTP status; no defects leak stack traces.
- Transactions: every multi-row state change runs in one transaction; no awaits on network calls inside a held row lock.
- Time: no client clock in lease logic; workers use the database clock where it matters.

Deliverable: per-file findings with line references.

## Phase 6 — Tests and verification

Question: what proves the invariants today, and what is missing?

- Inventory: matchd has unit tests per family and target; the API has two (routes and scale); web and CLI have none. There is no automated test of the full checkout loop (known in `roadmap.md`), and no CI config in the repo.
- Write the missing invariant tests against a real Postgres (compose), one per phase 2 invariant:
  - Two concurrent checkouts → one lease, one conflict.
  - Duplicate job result → one match, no clearing of a later lease. *Covered by `apps/api/scripts/verify-audit-fixes.mjs` (replayed job, stale result).*
  - Heartbeat past `max_hold_hours` is refused.
  - A worker with a different digest cannot record a match.
  - Kill matchd mid-compile → job requeues, result applies once. *Applies-once is covered by the replay check. Killing matchd itself is not tested yet.*
  - Sweeper and submit racing on the same chunk.
- End-to-end on the seed fixtures: `demo` matches, `sample` isolated `parse_header` does not match but the leaves do, `link` `decoy` matches alone and fails integration.
- Golden tests for every registered image: one known-matching source and one near-miss per target, run inside the real Docker image.
- Property or fuzz tests for `normalize.ts` and the objdump parsers. *`src/opcodeMask.test.ts` adds targeted opcode-vs-mask cases (A-006). It is not a fuzzer.*
- Turn `apps/api/scripts/verify-audit-fixes.mjs` into a proper test that runs in CI against a compose Postgres. Today it is a manual script that needs a running API and matchd.
- Load test: N concurrent contributors on a 100k-chunk project; measure checkout latency, claim throughput, queue wait, and when the scaler fires.
- Add CI: typecheck, unit tests, invariant tests against Postgres, and image builds.

Deliverable: test gap matrix (invariant × test exists) and a CI proposal.

## Phase 7 — Operations and deploy readiness

Question: can the us-east-1 deploy run safely and be debugged?

- Config: list every env var, its default, and whether a production default is unsafe (`MATCHD_TOKEN`, `BLOB_S3_*` dev credentials, `MATCHD_SCALE=docker`). Startup should refuse unsafe values in production.
- Secrets: no secrets committed (`apps/api/.env` is gitignored; confirm history), no tokens in logs.
- Observability: structured logs, request ids, metrics for queue depth, wait, compile time, match rate, sweeper actions. Health endpoints for API and matchd.
- Backups and restore for Postgres and the bucket; a tested restore.
- Failure drills from the architecture failure table: kill a matchd pool, kill the API mid-claim, fill the temp disk, Postgres restart.
- Capacity: compile cost per image, warm pool sizing, cost estimate for the first deploy.
- Run book for the `blob_objects` drop and the path-style to virtual-host S3 change.

Deliverable: deploy readiness checklist with pass, fail, or not checked per item.

## Phase 8 — Docs and developer experience

- Fresh clone to first match following only `README.md` and `AGENTS.md`, on Windows and Linux. Record every step that fails.
- Docs vs code drift found in earlier phases, collected in one list.
- Whether `roadmap.md` "Still open" is complete after the audit.

## Order and effort

| Phase | Depends on | Rough effort |
| --- | --- | --- |
| 1 Purpose | — | 0.5 day |
| 2 Architecture | 1 | 1 day |
| 3 Schema | 2 | 1 day |
| 4 Security | 2 | 2–3 days |
| 5 Code | 2, 3 | 3–4 days |
| 6 Tests | 2, 5 | 2–3 days (includes writing invariant tests) |
| 7 Operations | 4 | 1 day |
| 8 Docs | all | 0.5 day |

Phases 3 and 4 can run in parallel after phase 2. Fix Critical and High findings before the us-east-1 deploy; Medium before a public launch.

## Early signals

Found while writing this plan. Since fixed: the three matchd token items (A-019 to A-021), rate limits and body size (A-034, A-035), and CI (foundations plan 7d; CLI unit tests exist, web still has none). The Docker daemon dependency is still open.

- matchd bearer compared with `!==` (`apps/matchd/src/http/MatchdAuth.ts`). Phase 4.
- `MATCHD_TOKEN` silently defaults to `dev-matchd-token` in API, scaler, and matchd. Phase 4, 7.
- Scaler puts the token on the `docker run` command line (`apps/api/src/services/MatchdScaler.ts`). Phase 4.
- API needs the local Docker daemon when `MATCHD_SCALE=docker`, the `.env.example` default. Phase 4, 7.
- No rate limiting or body-size limits found in `apps/api/src/main.ts`. Phase 4.
- No CI config, no web or CLI tests. Phase 6. A manual end-to-end check now exists (`apps/api/scripts/verify-audit-fixes.mjs`).
- `schema-reasoning.md` covers migrations `001`–`008`; `009`–`011` exist. Phase 3, 8.

## Finding format

One row per finding in `docs/audit/findings.md` (created when the audit starts):

| Id | Phase | Severity | Invariant | Location | Finding | Reproduction | Fix | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A-001 | 4 | High | — | `apps/matchd/src/http/MatchdAuth.ts:28` | Non-constant-time token compare | … | `timingSafeEqual` on equal-length buffers | open |
