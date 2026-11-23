# Audit change log

Changes made because of the audit. Newest first. Finding ids refer to [audit-findings.md](audit-findings.md). The plan is [audit-plan.md](audit-plan.md).

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
