# Audit change log

Changes made because of the audit. Newest first. Finding ids refer to [audit-findings.md](audit-findings.md). The plan is [audit-plan.md](audit-plan.md).

## 2026-11-23 — Phase 3: schema, races, and query plans

Branch `audit/phase-3-schema`, off `main` at `f5418cf9b`. Not committed yet. Notes: [audit/phase-3.md](audit/phase-3.md).

### Database

- **Migration `012_job_integrity`:**
  - `jobs_one_active_interactive` (I3, A-029)
  - `jobs_chunk_id_idx` and `jobs_attempt_id_idx`
  - `chunks_updated_at_idx`
  - `chunks_board_idx` and `chunks_project_state_live_idx` (A-030)
  - `chunks_validating_idx`
  - `matches_chunk_id_idx`

  Indexes only, so it applies to an empty database without repair steps.

### Code

- `ChunksRepo.listByProjectSlug` filters by `project_id`, so the board uses the new index (A-030).
- `ChunksRepo.checkout` runs in one transaction:
  - a per-user, per-project advisory lock guards `max_held_chunks` (A-008);
  - the extra-lease path locks the chunk before counting (A-009).
- `LeaseSweeper` recounts board stats for every project with chunk changes in the last two minutes (A-016).
- `MatchWorker` recipe rechecks (A-022, A-031):
  - commit in one transaction, applied once;
  - touch only the match for their own attempt;
  - end with `failed` on an error instead of looping.
- `MatchWorker` miss path extends the lease within `max_hold_hours` (A-023).

### Docs

- `schema.md` documents `blob_objects` and migration 012, and updates the invariant lists. The drift check now reports no drift.
- `schema-reasoning.md` covers migrations 009–012.
- `roadmap.md` no longer says there is no web import UI. Together these close A-017.

### Verification

- `apps/api/scripts/verify-phase3.mjs`: 8/8.
- `verify-audit-fixes.mjs`: 14/14.
- Typecheck is clean, the unit tests pass (API 10, matchd 94), and the API log has no errors or deadlocks.
- Query plans before and after are in the phase notes.
- The race fixes were checked on the new code only. A race check can pass on the old code by chance.

### To apply locally

`npm run api:migrate` applies 012 to your dev database.

## 2026-11-23 — Scope note: test data only

All rows in the current databases are test data, and production starts with an empty database. So:

- A-024 (recheck matches made under the old relocation masks) is closed as not applicable. No production match was ever judged under the old masks. The "recheck after deploy" follow-up in the A-006 entry below no longer applies.
- Phase 3 migrations need to apply cleanly to an empty database, with no repair steps for existing rows.

## 2026-11-23 — Compile sandbox runs in Docker (A-027)

Branch `audit/matchd-seccomp`, off `main` at `e5aa1b7ed`. Not committed yet.

- **New `docker-yml/matchd-seccomp.json`:** Docker's default seccomp profile (`moby/profiles` tag `seccomp/v0.3.0`, Apache-2.0) plus one rule that allows `clone`, `mount`, `pivot_root`, `umount2`, and `unshare`.
  - Downloaded with your OK. Upstream sha256 and the reasoning are in `docker-yml/matchd-seccomp.md`.
  - `docker-yml/make-matchd-seccomp.cjs` regenerates the file from a new upstream copy. It reproduces the committed file byte for byte.
- **Compose:** the `matchd` service and all 17 pool services run with `security_opt: seccomp=docker-yml/matchd-seccomp.json`. The pool uses the `x-matchd-security` anchor.
- **Scaler:** copies started by `MATCHD_SCALE=docker` get `--security-opt seccomp=<profile>`. The default path is the repo copy, and `MATCHD_SECCOMP_PROFILE` overrides it. With scaling on, the API refuses to start if the file is missing.
- **matchd self-test** (`apps/matchd/src/sandboxSelfTest.ts`): with `MATCHD_SANDBOX=bwrap`, matchd starts one empty sandbox before it listens. If that fails, matchd exits with bwrap's error and the fix, instead of serving and failing every compile.

### Verification

- In a container with the profile, the exact `sandboxArgv` flags start bwrap. The sandbox sees no network interfaces.
- With the profile, outside bwrap, the container still cannot `mount` or `unshare` its own namespaces (the kernel refuses without `CAP_SYS_ADMIN`).
- All 17 rebuilt images pass the startup self-test with the profile. Without it, the base image exits with code 1 and the self-test message.
- The compose `matchd` logs `compile sandbox bwrap: self-test passed`.
- `verify-audit-fixes.mjs` passes 14/14 against the sandboxed matchd, so real compiles and matches work inside bwrap.
- `npm run typecheck` is clean. `npm run matchd:test` passes 94.
- Not run: an actual scale-out by the scaler. Its `docker run` flags (port, profile, token from the CLI environment) match what the image loop above used.

### Deploy note

Production matchd hosts must pass the same profile. A host that does not now fails at startup instead of silently.

## 2026-11-23 — Housekeeping after the security fixes

- Fast-forwarded `main` to `e5aa1b7ed`. Not pushed. `main` is 2 commits ahead of `origin/main`.
- Rebuilt the 17 matchd images that existed locally: `re-hydra-matchd` plus the n64, mwcc, coff, switch, ps1, ps2, psp, ps3, ps4, xbox, wiiu, ds, 3ds, dc, saturn, and genesis images. GBA was never built and was skipped. No image carries `MATCHD_TOKEN` any more.
- Recreated postgres, blobs, and matchd with `docker compose up -d`. All three publish on `127.0.0.1` only. Data survived in the named volumes: 7 projects, 8,705 chunks, 4 matches, 25,592 blob rows, 17,889 bucket objects.
- Created `apps/matchd/.env` from the example (gitignored) so host `npm run matchd` starts.
- Verified that matchd logs the dev-token warning and refuses a wrong token (401).

**New finding A-027 (Critical):** the rebuilt images run compiles under bwrap (`MATCHD_SANDBOX=bwrap`, added in `ae5d7f57c`). Docker's default seccomp profile blocks the user namespace bwrap needs, so every compile fails. The old images predated the sandbox, which is why the end-to-end checks passed yesterday and fail today (11/14: the three checks that need a real match). Tested on this machine:
- default container: `bwrap: No permissions to create new namespace`
- `--security-opt seccomp=unconfined`: the sandbox starts

Local matchd cannot compile until this is fixed. Not fixed yet: it needs a decision on the container's security settings.

## 2026-11-23 — matchd token and port fixes (A-019, A-020, A-021, A-025)

Branch `audit/security-matchd-token`, off `main` at `c065901a7`. Not committed yet.

### A-019 — constant-time token check

`apps/matchd/src/matchdToken.ts`, `apps/matchd/src/http/MatchdAuth.ts`

- matchd compares the bearer with `timingSafeEqual` on SHA-256 digests of both values. Before, it used `!==`. Hashing first keeps the lengths equal and hides the token's length.

### A-020 — no default token

`apps/api/src/services/matchdToken.ts`, `apps/matchd/src/matchdToken.ts`, `MatchdClient.ts`, `MatchdScaler.ts`, `MatchdAuth.ts`, all 18 `apps/matchd/Dockerfile*`

- `MATCHD_TOKEN` has no default in the API, the scaler, or matchd. A missing value stops startup with a ConfigError. An empty value stops it too.
- The well-known `dev-matchd-token` still works so local compose keeps running, but it logs a warning on every start.
- Found during the fix: every matchd Dockerfile set `ENV MATCHD_TOKEN=dev-matchd-token`, so any container started without the variable was open to the public default. Those lines are removed. Compose sets the token for every service, and the scaler passes it to the copies it starts.
- **Local setup change:** host `npm run matchd` now needs `apps/matchd/.env` (copy `.env.example`). Before, it fell back to the default.

### A-021 — token off the command line

`apps/api/src/services/MatchdScaler.ts`

- The scaler runs `docker run -e MATCHD_TOKEN` with no value and puts the value in the docker CLI's environment. Docker copies it from there, so the host process list no longer shows the secret. `docker inspect` on the container still shows it, as with any env var. A Docker secret would hide that too.

### A-025 — services published on localhost only

`docker-yml/docker-compose.yml`, `docker-yml/docker-compose.matchd-pool.yml`

- matchd (3001), every pool process (3010–3026), Postgres (5432), and the blob store (9000) now publish on `127.0.0.1` only. Before, they were on every interface, and Postgres and the blob store use well-known dev passwords. The per-console overlays inherit the base `matchd` service's port.

### Docs

- `apps/matchd/README.md`, `docs/roadmap.md` (first deployment), and both `.env.example` files say the token is required.

### Verification

- `npm run typecheck`: clean. Only warnings that were already there.
- `npm run matchd:test`: 94 pass, including the new `src/matchdToken.test.ts` (missing, blank, real, and dev tokens; equal and unequal compares).
- `npm test -w @re-hydra/api`: 10 pass.
- Live checks:
  - The API and matchd both exit with `ConfigError ... MATCHD_TOKEN` when it is unset.
  - matchd started with the dev token logs the warning. A request with the right token gets past auth (400 for an empty body), and a wrong or missing token gets 401.
  - `docker run -e MATCHD_TOKEN` with the value only in the CLI's environment delivers it inside a local matchd image.
- Not run: a full scale-out by the scaler.

### To apply locally

- Running containers keep their old port bindings until recreated: `docker compose up -d`. The Postgres data is in its volume.
- Images built before this change still carry the baked token until rebuilt (`--build`). They are also needed for the A-006 mask fix (A-024).

## 2026-11-22 — Fixes for A-001 to A-006

Base: `main` at `cd2a88feb`. Nothing is committed yet.

### A-001 — match results apply once, only to the live attempt

`apps/api/src/services/MatchWorker.ts`

- The interactive result is one transaction. It first moves the job from `claimed` to `succeeded` (`finishJob`). Only the run that wins that update writes anything else, so a job whose claim expired and ran twice applies once.
- It then locks the chunk and checks `state = 'validating' AND lease_token = attempt.lease_token` before it inserts a match. If the lease moved on while the job ran, the attempt keeps its score and the chunk is left alone. Before, the match row was written first, which could leave an orphan active match that blocked every later match on that chunk.
- The move to `matched` now also checks the lease token.
- The canonical-bytes blob row is written only when there is a match.
- A job that throws after it is claimed is now ended with `failJob` instead of being left `claimed`. Before, an error in the commit (for example the unique index on active matches) made the job fail again every 2 minutes forever. Interrupts still pass through.
- Type recheck results use the same pattern: one transaction, gated on `finishJob`.

### A-002 — one submission in flight per chunk

`apps/api/src/services/AttemptsRepo.ts`

- Submit only moves a chunk from `leased` to `validating`. A second submit while `validating` returns 409 Conflict.
- Resubmitting the same bytes under the same lease still returns the existing attempt, now also while it is `validating`. The lookup also checks `user_id`.

### A-003 — submit is one transaction

`apps/api/src/services/AttemptsRepo.ts`

- An unlocked pre-check refuses callers without the lease before any blob is written.
- The source blob is written before the transaction, so no row lock is held during bucket I/O. Blobs are content-addressed, so an unused one is harmless.
- Inside one transaction: lock the chunk (`FOR UPDATE`), return the prior attempt if there is one, move to `validating`, insert the attempt, insert the job, refresh stats. Any failure, including a missing type revision, rolls back the move to `validating`. Before, the job was inserted even when the state change touched no row.
- The extra-holder path (taking over the primary slot on submit) is unchanged in effect. It now runs inside the same transaction and requires `state = 'leased'`.

### A-004 — `validating` always has a way out

`apps/api/src/services/MatchWorker.ts`, `apps/api/src/services/LeaseSweeper.ts`

- `failJob` marks the job failed, writes the reason to the attempt's diagnostics, and returns the chunk to `leased` for the same holder (`releaseValidating`). It covers attempt missing, source or original bytes missing, and any error while running the job.
- The lease sweeper has a backstop. A chunk that has been `validating` for 5 minutes with no queued or claimed interactive job goes back to `leased`, with a warning in the log.
- If the stored lease had no expiry, the handed-back lease gets a fresh one from `projects.lease_hours`.

### A-005 — a failed recheck compile no longer stalls a proposal

`apps/api/src/services/MatchWorker.ts`

- A recheck whose compile fails, or that fails before compiling, now counts toward `revalidation_done` and calls `finalizeProposalIfDone`. The match stays in place, as `architecture.md` already describes. Before, no counter moved and the proposal stayed `revalidating` forever.
- Follow-up: `revalidation_done` now mixes "matched" and "could not check". A third counter (or a job-state count) would let the proposal page show unchecked chunks. That needs a migration and is not done.

### A-006 — relocations blank bits, not whole instructions

`apps/matchd/src/families/types.ts`, `normalize.ts`, `families/ppc.ts`, `families/arm.ts`, `families/mips.ts`, `families/aarch64.ts`

- New field kind `RelocMask { span, unit, fieldBits }`: one bit mask per 2- or 4-byte instruction unit, in the order objdump prints. `normalize.ts` masks per bit and spreads each mask over the bytes by target endianness.
- `immediateBits` now masks exactly the low N bits, including 26. This changes `R_MIPS_26` and `R_AARCH64_CALL26`/`JUMP26`, which used to blank the whole word.
- PowerPC: `REL24`, `ADDR24`, `PLTREL24`, `R_PPC64_REL24`, `IMAGE_REL_PPC_REL24`, and `IMAGE_REL_PPC_ADDR24` blank `0x03fffffc` (keeps the opcode, AA, and LK). `REL14`/`ADDR14` and their COFF forms blank `0x0000fffc`. `EMB_SDA21` blanks `0x001fffff` (keeps the opcode and `rD`).
- ARM: Thumb `THM_CALL`/`THM_JUMP24` blank `0x07ff` and `0x3fff` per halfword (keeps the branch encoding, allows the BL to BLX flip). `THM_JUMP11` and `THM_PC8` mask their immediates. ARM `MOVW`/`MOVT` blank `0x000f0fff`, Thumb `MOVW`/`MOVT` blank `0x040f` and `0x70ff` (keep the opcode and `Rd`).
- The masked diff prints a fully blanked nibble as `?`. A partly blanked nibble prints the bits that remain, so a `bl` shows `48 ?? ?? ?1`.
- Existing tests updated for the new output. New `src/opcodeMask.test.ts` covers `b` vs `bl`, `lwz` vs `stw`, `beq` vs `bne`, Thumb `B.W` vs `BL` (and BL vs BLX still matching), MOVW register, MIPS `j` vs `jal`, and AArch64 `b` vs `bl`.
- Not changed: AArch64 `ADRP`, `LO12`, and `MOVW` relocations still blank the whole instruction. SuperH and 68000 were not reviewed for this.
- **Follow-up for deployed data:** matches recorded before this change on PowerPC, ARM, MIPS, and AArch64 targets were judged under the looser rule. They should be rechecked. The matchd Docker images also need a rebuild to pick this up.

### Docs

- `docs/roadmap.md`: the compiler notes for N64, PS1, GameCube, Wii U, PS3, GBA, and Switch now describe bit masks.
- `docs/architecture.md`: the normalized match rules say only linker-written bits are blanked, and that relocation targets are not compared.

### Verification

- `npm run typecheck`: clean. Only warnings that were already there.
- `npm run matchd:test`: 91 pass, 0 fail (was 84, plus 7 new).
- `npm test -w @re-hydra/api`: 10 pass, 0 fail.
- New end-to-end script `apps/api/scripts/verify-audit-fixes.mjs`, run against a throwaway database (`rehydra_audit`), a real API, and the running host-gcc matchd. 14 checks covering A-001 to A-005:
  - With the fixes: 14/14 pass.
  - With the old code: the double submit is accepted and queues 2 jobs, a stale result writes an orphan match, and a replayed job never finishes. So the script fails on the old code and passes on the new.

To rerun:

```powershell
docker exec re-hydra-postgres-1 psql -U rehydra -d rehydra -c "CREATE DATABASE rehydra_audit"
```

```powershell
$env:DATABASE_URL = "postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit"; npm run api:migrate; npm run api:seed
```

```powershell
$env:DATABASE_URL = "postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit"; $env:API_PORT = "3100"; $env:MATCHD_SCALE = "off"; npm run start -w @re-hydra/api
```

```powershell
$env:AUDIT_API = "http://localhost:3100/v1"; $env:AUDIT_DATABASE_URL = "postgres://rehydra:rehydra@127.0.0.1:5432/rehydra_audit"; node apps/api/scripts/verify-audit-fixes.mjs
```

The script refuses a database whose name doesn't contain `audit` or `test`, because it resets the `demo` chunk.

### Noticed while fixing (not changed)

- After a miss, a chunk returns to `leased` with the expiry it had before the submit. If the queue wait was long, the sweeper may expire it soon after. Consider extending the lease on a miss.
- The recipe recheck path (`processRecipe`) still writes without a transaction. Same pattern as A-001, lower risk because it never inserts a match.
- The `matchd` container publishes port 3001 on `0.0.0.0`, not only on localhost. Phase 4.
