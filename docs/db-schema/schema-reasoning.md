# Why the schema looks like this

Status: rationale for [schema.md](schema.md), including migrations `001` through `008`. How the system runs: [architecture.md](../architecture.md). What is next: [roadmap.md](../roadmap.md).

## The lease is a column set, not a child table

Checkout must be exclusive under concurrent writers. The product plan is a single conditional `UPDATE` on the chunk:

```sql
WHERE id = $id AND state = 'open' AND lease_user_id IS NULL
```

If leases lived in a separate `leases` table, checkout would need to insert a lease and update the chunk (or read the latest lease) in one transaction, with a unique constraint on `chunk_id` for active leases. That works, but the lock is spread across two rows and every read of "is this chunk free?" becomes a join or a partial unique lookup.

Putting `lease_user_id`, `lease_token`, `lease_expires_at`, and `hold_started_at` on `chunks` keeps the critical path on one row. Postgres locks that row for the update. Zero rows returned is a conflict. Heartbeat, release, submit-to-validating, and expiry are all mutations of the same columns plus `state`.

A history of past leases is not required for the product. Attempts already record who submitted under which `lease_token`. Project activity is an append-only `project_events` row, written by the application. Do not move the live lock off `chunks`.

When `projects.max_concurrent_leases` is above 1, extra holders are rows in `chunk_leases`. The chunk row still holds the primary lease, and checkout of that primary is still one conditional update. `validating` stays one row: a submit from an extra holder moves that token onto the chunk and parks the previous primary in `chunk_leases`. A match releases the side rows. The default cap is 1, so `chunk_leases` is empty on a normal project.

## State and lease columns are checked together

An `open` chunk with a leftover `lease_token` would make expiry and checkout disagree. The `CHECK` on `chunks` ties each `chunk_state` to the legal nullness of the lease fields. That catches application bugs at write time instead of leaving a board that looks open while a token still works.

`validating` keeps `lease_user_id` and `lease_token` so a failed match returns the chunk to the same person. `matched` and `blocked` clear the lease so the sweeper and heartbeat ignore them. `stale` also clears the lease, and it stays `stale` after release, expiry, and a cleared lease. Checkout can lease a stale chunk again. Migration `007` only repaired rows that an earlier release had left `open` after their match was invalidated. It did not add a column.

## Attempts are append-only; matches are a separate proof

A submit creates an attempt before the compile finishes. The score, diagnostics, and `matched` flag are filled when the job returns. Retries with different source create new rows. Resubmitting the same bytes under the same lease hits `UNIQUE (chunk_id, lease_token, source_sha256)` and returns the existing attempt. That is the idempotency key from the architecture doc.

A match is not "the attempt with score = 1". It is a proof record: which attempt, which type revision, which toolchain digest, which canonical encoding. Type proposals invalidate matches without deleting attempts. The next person still inherits prior source through `best_attempt_id` and the attempts list. Keeping proofs in `matches` lets `chunks.current_match_id` point at the live success and lets `invalidated_at` preserve history when a struct change breaks the bytes.

One active match per chunk (`UNIQUE` where `invalidated_at IS NULL`) stops two perfect scores from both counting toward progress.

## Blobs are content-addressed and out of band

Pseudocode, disassembly, original function bytes, submitted source, type headers, and canonical encodings are large and immutable for a given hash. Storing them in Postgres would bloat the writer, slow replicas, and fight the multi-region object plan.

The `blobs` table is a registry: sha256, size, content type. Tables hold foreign keys to `sha256`. Object storage holds the bytes. Deduplication is free when two attempts or two imports share content. Work-bundle manifests list hashes; signed URLs point at the nearest bucket.

Job rows store source as a JSON list of path + hash, not inline text. The architecture allows small inputs inside a job for matchd start latency; the durable schema still prefers hashes so the writer does not become a file store. If a worker needs inline bytes for a cold region, the API can hydrate from the home bucket when claiming, without changing the table.

## Address ranges use `int8range` and an exclusion constraint

Checkout must refuse overlaps with fused chunks and other active ranges. Ghidra functions are naturally an address and a size. Representing them as a stored `int8range` lets Postgres enforce non-overlap with:

```sql
EXCLUDE USING gist (binary_id WITH =, addr_range WITH &&)
```

That belongs in the database because two concurrent imports or a fusion race cannot be trusted to the application alone. Half-open `[address, address + size)` matches how sizes are usually talked about in RE tools and avoids adjacent functions falsely overlapping.

Chunk identity also includes `bytes_sha256`. Re-importing the same function updates pseudocode via a new blob hash on the same row (or a controlled replace); it must not create a second claimable row for the same body. The unique index on `(binary_id, bytes_sha256, address, size)` is that identity.

## Fusion is a parent chunk, not a join-only group

A fused unit is leased, submitted, and compiled as one. The cleanest model is another `chunks` row: the parent has the covering range, members set `fuse_parent_id` and leave the open pool. Checkout rejects rows with `fuse_parent_id IS NOT NULL`. The parent's range satisfies the exclusion constraint once members are removed from the address space or are no longer separate overlapping rows.

A pure many-to-many "fusion group" without a parent row would still need a single lease target. That recreates a lease table for groups. Parent-as-chunk keeps the exclusive update unchanged.

## Call graph and type refs are edges, not locks

Callees are stored in `chunk_callees` so the work list can sort leaves first and so the work bundle can list neighbor signatures. They do not participate in checkout. Putting them in JSON on the chunk would make graph queries and "what calls this?" awkward as projects grow.

`chunk_type_refs` exists for the same reason on the type side: a proposal that changes `Header` must find every matched chunk that uses `Header`, and an unresolved-type mark must find chunks to move to `blocked`. String names match what Ghidra exports and what headers declare. They are not normalized into a types table in milestone 1; the type environment is the headers blob on `type_revisions`.

## Type revisions are immutable; proposals are the mutable workflow

Every lease and every match pins a `type_revision_id`. If headers were updated in place, old matches could not be revalidated and work bundles would silently change under an open lease.

A proposal points at a base revision and a new headers blob. `affected_types` names the structs the recheck must find. While `revalidating`, jobs fan out. Counters on the proposal row (`revalidation_total` / `done` / `failed`) give the UI a progress signal without aggregating the job table on every refresh. `revalidation_started_by` is who started that recheck. When it finishes and the project has a second owner or maintainer, the state becomes `ready` until a different privileged member accepts. `reviewed_by` is who accepted. Accept creates a new `type_revisions` row and never edits the old one. The revision's `created_by` stays the proposal author.

## Jobs live next to attempts so claim and commit share a writer

matchd is stateless. Something durable must hold the queue. At stage A/B that is `jobs` on the same writer as leases. `FOR UPDATE SKIP LOCKED` on a partial index of queued jobs is enough at "compiles in flight" scale. Interactive vs revalidation is `kind` plus `priority`, so a bulk revalidation cannot starve submits without an application-level slot reserve on top.

Results commit only if the chunk is still `validating` for that attempt. The schema supports that by keeping `attempt_id` on the job and requiring the application to update `chunks` and `attempts` in one transaction when applying `result`. A separate message bus later can replace the queue without changing `attempts` or `matches`.

## Auth tables stay minimal

Passwords are stored as scrypt strings on `users.password_hash`. The raw password never hits the database. Sessions are hashed bearer tokens with expiry and a revoke timestamp. Profile tokens for the CLI live in `access_tokens`, hashed the same way, and stay valid across a password change until revoked. Email is `citext` so directory identity is case-insensitive without application filters.

## Membership encodes the three roles from the product plan

`owner` / `maintainer` / `contributor` map to who can import, fuse, clear leases, and who can only checkout and propose types. A partial unique index enforces a single owner without a second "owners" table. Permissions are checked in the API; the table is the source of truth for role, not a duplicate ACL document.

## Counters are denormalized on purpose

A project page needs open / leased / matched counts. Counting `chunks` by state on every view becomes expensive past tens of thousands of functions. `project_chunk_stats` is updated in the same transaction as state changes (or by a tightly scoped trigger). It can be rebuilt from `chunks` if it drifts. This is deliberate denormalization for a read-heavy board, not a second source of lease truth. Checkout still uses the chunk row.

## What was rejected

| Alternative | Why not |
| --- | --- |
| Separate `leases` table | Splits the exclusive lock; more joins for the hottest path |
| Soft-delete chunks and keep overlaps | Breaks a simple interval set; fusion and checkout become heuristic |
| Store source and pseudocode in `bytea` columns | Writer and replica bloat; fights multi-region object design |
| Mutable `types` row per project | Invalidates the meaning of old matches and open leases |
| Enum for language globally | Owners pin project language strings; new languages should not need a migration |
| Global serial ids | Multi-region homes need API-allocated UUIDs; no cross-region sequences |
| Embedding call graphs in JSON only | Blocks leaf-first SQL sorts and reverse lookups |
| One table for attempts and matches | Failed compiles and invalidated proofs are not the same thing as success |

## How this serves multi-region later

`projects.home_region` is present from day one so stage C does not rewrite the table. Primary keys are UUIDs. Blob references are hashes, so replication is object-store replication, not row shipping of payloads. Job and lease writes stay on the project home writer; the schema does not assume a second writer can update the same `chunks` row. Replica reads of the board may lag; the lease token in the checkout response is still the authority.

## Open schema questions

- Whether cleared `unresolved_types` rows are kept forever or archived after N days. The partial unique index allows history either way.
- Whether `jobs.sources` should eventually drop hashes-only and require a side channel for inline hydration, or store a small inline cache for functions under a size cap. Start with hashes; measure cold-start latency before denormalizing bytes into the writer.
- Whether fusion should delete member rows or only mark them. Members stay, with `fuse_parent_id` set, and they must not occupy `addr_range` under the exclusion constraint. What a later split does with a member that already matched is still open. See [roadmap.md](../roadmap.md).
