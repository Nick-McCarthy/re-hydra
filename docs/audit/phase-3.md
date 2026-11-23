# Audit phase 3: data and schema

Status: done 2026-11-23 on branch `audit/phase-3-schema`, off `main` at `f5418cf9b`. Plan: [../audit-plan.md](../audit-plan.md). Findings: [../audit-findings.md](../audit-findings.md). Changes: [../audit-changelog.md](../audit-changelog.md).

All current data is test data, and production starts with an empty database. So migration 012 only needs to apply cleanly to an empty database. It has no repair steps.

## Method

1. Diffed `schema.md` against a database with every migration applied: tables, columns, indexes, and enum labels (a small script over `information_schema` and `pg_indexes`).
2. Listed every constraint on the core tables and mapped each phase 2 invariant to a constraint or to code.
3. Loaded a synthetic project into the throwaway `rehydra_audit` database: 100,000 chunks (64,667 open, 33,000 matched, 1,333 stale, 1,000 leased) plus 50,000 finished attempts and jobs. Then ran `EXPLAIN ANALYZE` on the hot queries.
4. Fixed what the measurements and the race findings called for, then checked each fix end to end (`apps/api/scripts/verify-phase3.mjs`).

## Schema doc drift

`schema.md` matched the database for every table, column, index, and enum label except `blob_objects`, the Postgres blob fallback. That table is now documented, along with migration 012. The drift check reports no drift after the update.

`schema-reasoning.md` stopped at migration 008. It now covers 009–012 (part of A-017).

## Invariants: database or code

| # | Invariant | Before phase 3 | Now |
| --- | --- | --- | --- |
| I1 | One primary lease per chunk | Conditional `UPDATE`, `chunks` CHECK, `chunks_lease_token_uidx` | Unchanged |
| I2 | Extra holders below `max_concurrent_leases` | Code, racy (A-009) | Code: the chunk is locked before counting. Checked with two racing users |
| — | Held chunks below `max_held_chunks` | Code, racy (A-008) | Code: per-user, per-project advisory lock. Checked with six parallel checkouts |
| I3 | One unfinished interactive job per chunk | Code only | **Database:** `jobs_one_active_interactive` |
| I4 | Commit only for the live attempt | Code | Unchanged (row lock plus lease-token check) |
| I5 | One active match per chunk | `matches_one_active_per_chunk` | Unchanged |
| I6 | Database-clock expiry, hold cap | Code | Code. A miss now extends the lease within the cap (A-023) |
| I8 | A retried job applies once | Interactive and type rechecks | Recipe rechecks too (A-022) |
| I9 | Board counts follow chunk state | Recount, could go stale under concurrency | Recount plus a sweeper repair. Converges within 30 s (A-016) |
| I10 | No overlapping ranges | `chunks_no_overlap` | Unchanged |

Left in code on purpose:

- **I4:** a constraint would need the chunk's lease token on the match row.
- **The board counters:** a row lock on `project_chunk_stats` would deadlock. Several transactions refresh the counts and then lock another chunk, for example the type-recheck path and `landProposal`.

## Query plans at 100,000 chunks

| Query | Before | After | Change |
| --- | --- | --- | --- |
| Board page, first 100 | 55 ms, scans and sorts the project | 0.2 ms | `chunks_board_idx` and filtering by `project_id` instead of slug. With the slug join the planner could not see the project's size. Still 0.2 ms after 7 prepared executions (generic plan) |
| Board page, offset 90,000 | 54 ms | 50 ms (index-only walk) | Deep offsets stay linear. Keyset paging would fix it if anyone pages that deep |
| Board search by name (`ILIKE '%…%'`) | 49 ms | ~100 ms (varies) | Not fixed. Needs a `pg_trgm` index (A-028) |
| Stats recount | 15 ms | 12 ms, index-only | `chunks_project_state_live_idx` |
| Sweeper: orphaned `validating` | 11 ms full scan every 30 s | 0.04 ms | `chunks_validating_idx` |
| Sweeper: expired leases | 0.03 ms | — | Already indexed |
| Checkout claim, held count, job claim | 0.2–1.9 ms | — | Already fine |
| Prior-attempt job lookup | — | 0.07 ms | `jobs_attempt_id_idx` |
| Recently changed projects (for A-016) | — | 0.1 ms | `chunks_updated_at_idx` |

`jobs` had no index on `chunk_id` or `attempt_id`, so deleting an attempt or a chunk scanned `jobs` to cascade. Both indexes are in migration 012.

## Fixes

- **A-008:** checkout runs in one transaction with `pg_advisory_xact_lock(hashtext('held:<project>:<user>'))` taken first.
- **A-009:** the extra-lease path locks the chunk in its own statement before the insert counts `chunk_leases`.
- **A-016:** the lease sweeper recounts every project whose chunks changed in the last two minutes.
- **A-022:** recipe rechecks commit in one transaction gated on the job still being `claimed`. An error ends the recheck instead of looping. Found during the fix: a missed recheck invalidated every active match on the chunk, including a newer match from a different attempt. Now it only touches the match for its own attempt.
- **A-023:** a miss sets `lease_expires_at` to the later of the current expiry and a fresh `lease_hours` window, capped at `max_hold_hours`.
- **I3:** migration 012's `jobs_one_active_interactive`.

## Verification

`apps/api/scripts/verify-phase3.mjs` against the running API, the sandboxed matchd, and `rehydra_audit`: 8/8.

- I3: a second queued interactive job on a chunk fails with SQLSTATE 23505.
- A-008: six parallel checkouts by one user with `max_held_chunks = 2` grant exactly 2.
- A-009: two users racing for the last extra slot (`max_concurrent_leases = 2`) get one lease.
- Board page over HTTP on the 100k project: 100 rows, 9 ms round trip.
- A-023: a miss on a lease with 1 minute left leaves more than 1 hour.
- A-022: a `-O0` recipe recheck for an older attempt leaves the current match. The same recheck for the current attempt makes the chunk stale (control).
- A-016: board counts corrupted by hand are repaired by the sweeper within 45 s.

Also: `verify-audit-fixes.mjs` still passes 14/14, `npm run typecheck` is clean, the unit tests pass (API 10, matchd 94), and the API log has no errors or deadlocks.

Not done: the race checks (A-008, A-009) were not run against the old code, because a race can pass by chance. Their fixes are argued from Postgres locking rules and confirmed only on the new code.

## Still open from this phase

- **A-028:** substring search on the board needs a `pg_trgm` GIN index on `chunks.name`.
- **Deep board offsets:** use keyset paging if anyone needs it.
- **Data retention (sessions, revoked tokens, `project_events`, cleared `unresolved_types`):** nothing expires today. Decide before launch. Not a correctness issue.
