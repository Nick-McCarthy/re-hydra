# re-hydra roadmap

Milestones 1–4 are done. What comes next, in order, is the Next section. Compiler images through Genesis are registered. Match capacity on one site is in place through an extra copy of a busy image. The next capacity step is a second site, which is still design. How the system runs is [architecture.md](architecture.md). The tables are [db-schema/schema.md](db-schema/schema.md).

## Product

| Milestone | State |
| --- | --- |
| 1 — claim, translate, prove | Done. Password sign-up and sign-in, public projects, Ghidra import, exclusive lease, directory, web checkout and submit, CLI, one matchd image, stored proof |
| 2 — shared types | Done. Proposals, revalidation, unresolved marks, fuse. A second privileged member accepts when the project has more than one |
| 3 — directory | Done. Follows, activity, people search, reputation, competing leases (default 1, cap 2–8) |
| 4 — integration | Done. Link matched functions at their original addresses. A miss reopens that chunk. The owner can pin C or C++. Isolated match stays the checkout success |

The CLI covers milestone 1. Follow, search, the lease cap, language, and integration builds are API and web.

Profiles have tabs. Everyone sees Overview, Matches (paged, filtered by project and status, sorted), and Projects (memberships, including contributor, and projects with surviving matches). Your own profile adds My work: every lease you hold across projects, with a countdown, Extend, and Release, plus submissions still being checked and your last ten results. Following (also yours only) lists the people and projects you follow, with Unfollow. Pending ownership offers show above the tabs. API: `GET /me/work`, `GET /users/:id/matches`, `GET /users/:id/projects`. Checked by `apps/api/scripts/verify-profile.mjs`.

On a members-only project, a signed-in non-member can ask to join, with an optional message of up to 200 characters. One open request per user per project; after a decline they may ask again 7 days later. Owners and maintainers answer in the project's Members card and in "Waiting on you" on their My work tab. Approving adds a contributor. Requesters see their state on the project page and in My work. Only approvals reach the feed. There is no nav badge or email. Checked by `apps/api/scripts/verify-join.mjs`.

The project page has tabs, chosen with `?tab=`: Chunks (the default: the board, plus Fuse for managers), Discussion, Activity, Members (with a count of open join requests for managers), Build (integration build and the compiler recipe), and Settings (owners and maintainers only: import, competing leases, recipe, who may work here). An unknown or unavailable tab falls back to Chunks.

Discussion is threads with flat replies. Anyone reads; anyone who may work on the project (not blocked, and a member when it is members-only) starts threads and replies. A thread may point at a chunk, and the chunk dialog links to its threads. Authors edit and remove their own posts and may rename or remove their thread; owners and maintainers remove any post and pin, lock, or remove threads. A removed post keeps its place. Posts are plain text with `inline code`, fenced blocks, and links. Only "X started a thread" reaches the feed. Thread starts are limited to 10 an hour and replies to 30 per 10 minutes per address. Not yet: unread tracking, mentions, notifications. Checked by `apps/api/scripts/verify-discussion.mjs`.

Forgot password: the sign-in page links to a form that emails a reset link. The link carries a one-hour, single-use token in the URL fragment; only its hash is stored. The request answers the same whether or not the email has an account, and is limited per client and to 3 emails an hour per address. Setting the new password ends every session. Accounts that never had a password can set one this way. Mail goes through `MAIL_DRIVER`: `log` and `file` for local use, `ses` (Amazon SES v2) for production, which has not yet been tried against SES. Checked by `apps/api/scripts/verify-password-reset.mjs`.

Content policy enforcement (migration 022). Sign-up requires agreeing to the content policy and records which version. The import form has three rights confirmations; the API refuses an import without `rightsConfirmed=true` and records who confirmed. Signed-in users can report a project, a function (chunk dialog), or a post, choosing copyright, malware, abuse, or other; 10 reports an hour. Site admins have `/admin`: the report queue, archive and restore projects, remove posts, suspend and restore accounts, and the record of every action. Each action needs a note and is written in the same transaction as the change. Suspending signs the account out everywhere and revokes its access tokens; a suspended account cannot sign in. Admins are granted only from the command line (`npm run api:admin -- grant <email>`, `revoke`, `list`), so a stolen admin session cannot make more. `/policy` shows sections 1–5 of [content-policy.md](policy/content-policy.md), linked from the footer, sign-up, and import. Imports no longer accept the whole program (`binaryBase64`); only its hash is kept, and the link fixture's ELF lives in `fixtures/link/link.elf` for matchd's tests. Checked by `apps/api/scripts/verify-moderation.mjs`.

Site admins are emailed about new reports (migration 023). Every `REPORT_NOTIFY_SECONDS` (default 60) a worker claims reports nobody has been told about, sends each active admin one email listing them (reason, project, function or post, an excerpt, a link to `/admin`), and marks them notified in the same transaction. A burst of reports is one email. A failed send leaves the batch for the next tick; with no admin, reports wait and the API logs a warning each tick. Several API processes never mail the same report (`SKIP LOCKED`). Reports filed before migration 023 count as already notified. Checked by `apps/api/scripts/verify-report-emails.mjs`.

Submitted source is released under CC0 1.0 (policy 2.4, migration 024). The work dialog says so under Submit, `hydra submit` prints it, the agent instructions tell the agent to write the source itself, and each attempt records `source_license` (earlier attempts have none). Repeat infringers (policy 2.5 and 3): admins add a strike with a note on the Users tab, or reverse one with a note, and both go in the record. A strike counts for 12 months unless reversed; the Users tab shows each account's active count and flags three, the point at which the policy says close the account. Suspending stays a manual step, so a counter-notice can be handled first. Checked by `apps/api/scripts/verify-moderation.mjs`.

Known-malware check (policy 4.3, migration 025). A worker downloads a SHA-256 list (`MALWARE_HASHLIST_URL`, MalwareBazaar by default, with `MALWARE_HASHLIST_AUTH_KEY`) every `MALWARE_HASHLIST_REFRESH_HOURS` (default 24); plain text, ZIP, gzip, and CSV all parse. A failed or empty download keeps the old list and is retried after an hour. An import whose program hash is listed is refused before anything is stored, and recorded as a hit. After each refresh, programs already on the site are checked again; a newly listed one is a hit, and its project stays up until an admin decides. Admins are emailed about hits (`MALWARE_NOTIFY_SECONDS`, default 60) and work them on the Known malware tab of `/admin`: confirm, archive the project, or allow (a false positive: the hash is never matched again). Both decisions go in the record. Without a URL nothing is downloaded. The check sees only the hash the export reports. Checked by `apps/api/src/services/malwareList.test.ts` and `apps/api/scripts/verify-malware-hashes.mjs`.

The CLI covers the work loop (`next`, `checkout` by name or address, `status`, `refresh`, `submit` with a byte diff on a miss, `watch`, `release`), types (`types show`, `propose`, and the maintainer commands), `import`, and `integrate`. Exit codes tell scripts and agents what happened. The commands and codes are in [apps/cli/README.md](../apps/cli/README.md). Checked by `apps/cli/src/byteDiff.test.ts` and by hand against the link fixture.

Refusals say why (foundations plan 1). Every bare `Conflict` and `BadRequest` is now a problem from `apps/api/src/domain/Problems.ts` with a `reason` code and a `detail` sentence: `ChunkRefused` (taken, already held, validating, lease gone, …), `IntegrationRefused`, `ProposalRefused`, `ProjectRefused`, and `InvalidRequest` (400). Statuses are unchanged except following yourself (409 → 400). Writes that cannot return nothing now die instead of answering 409. The web shows the detail; the CLI prints it, exits 5 when a lease is gone, and no longer guesses. `Problems.test.ts` fails on a new bare `Conflict` or `BadRequest`. Checked with the verify scripts (checkout loop, members, join, discussion, moderation, small fixes, audit fixes) and by hand with the CLI.

Profile tokens have a scope (foundations plan 2, migration 027). A **work** token can check out, submit, heartbeat, release, read bundles, propose types, and read the holder's own data; the server refuses it everything else with a 403 `TokenScopeRefused`, including integration builds. A **full** token can do anything the account can. Endpoints open to work tokens are marked `AllowWorkToken` in `Api.ts`, so new endpoints are closed to them by default. New tokens default to work; tokens from before keep full access. The profile page picks the scope; the skill, FAQ, and CLI README tell people to give agents a work token. Checked by `apps/api/scripts/verify-token-scopes.mjs`.

People can change their display name and delete their account on the Account page (`/account`; foundations plan 3, migration 028). Deletion asks for the password. It is refused while the account owns projects that are not archived, unless they choose to archive them. It is also refused for a suspended account, and while one of the account's submissions is being checked. Attempts, matches, posts, and events stay, shown as from a deleted account. Leased chunks go back to the pool. Strikes are kept against a hash of the email, which a new sign-up with that email takes back. Admins handle requests by email with `npm run api:admin -- delete-user <email> [--archive-projects]`. Checked by `apps/api/scripts/verify-account-deletion.mjs`.

One command runs the end-to-end checks (foundations plan 7d). `npm run verify` creates a fresh database, migrates and seeds it, starts the API on a free port without `apps/api/.env`, runs the `verify-*.mjs` scripts in turn (restarting the API when a script needs different settings, such as rate limits on or a proxy in front of matchd), and drops the database. Scripts that compile are skipped when matchd is not running (`--require-matchd` fails instead); `--only`, `--list`, and `--keep` narrow, preview, and keep the database. `verify-flags`, `verify-phase3`, and `verify-small-fixes` still run by hand: the first needs every compiler image, the other two the 100,000-chunk `scale100k` project. `npm test` runs the unit tests of the API, CLI, and matchd. GitHub Actions (`.github/workflows/ci.yml`) runs typecheck, unit tests, and the web build on every push to main and every pull request, and `npm run verify` in a second job with Postgres and the default matchd from Compose. `fixtures/link/dogfood.mjs` is gone; the checkout-loop script covers what it did.

Agents can use the CLI. `hydra skill install` writes the agent skill that ships in `apps/cli/skill/SKILL.md`; it covers the loop, exit codes, when to give up and release, and what an agent must not do (start integration builds, import, or accept types). The server enforces that for a work token. `instructions.agent` lets an agent submit with `hydra submit` when the person told it to. What an agent submits counts as the account holder's (policy 2.4). The CLI goes on npm once the API is stable enough to promise no breaking changes (foundations plan 5).

The whole contributor loop (import, checkout, heartbeat, miss, match, profile, call-target refusal, integration build, release, sweeper expiry) runs against a real matchd in `apps/api/scripts/verify-checkout-loop.mjs`.

An integration build defines every imported function it does not link at its original address, and blanks references it cannot place (string literals, library code, anything the import does not name). Before this, those resolved to address 0, so a correct match that called an unmatched function was reopened. Checked by `apps/matchd/scripts/verify-link-symbols.mjs`.

`ExportReHydra.java` also exports labelled data (globals in non-executable blocks) and thunks as `symbols`. An import stores them in `binary_symbols` (migration 020); an import without `symbols` keeps the stored list, and one with `symbols` replaces it. The integration build defines those names at their addresses too, so a wrong global address now fails the build instead of being blanked. Existing projects need a re-export from Ghidra to get symbols. Checked by `apps/api/scripts/verify-import-symbols.mjs`.

The link step runs with each target's own compiler flags and linker (`tools.ld` in the target file; lld for `switch-clang` and `ps4-clang`). It places each unit's code section so the function lands on its address, defines known symbols in the script, and reads the result straight from the ELF section headers. On ARM, a known callee of a Thumb branch is defined with `.thumb_set` in a small assembled object (`tools.thumbAs`): a linker-script symbol counts as ARM code, and ld would route the call through an interworking veneer. Base-relative references (PowerPC small data, MIPS `$gp`) get a placeholder in a real `.sdata` and are blanked, because the original base register value is not known. `apps/matchd/scripts/verify-link-targets.ts` builds a reference program on each image and checks that a linked call and a global land where the reference put them, and that a wrong global address fails:

| Target | Integration build |
| --- | --- |
| host, n64, ps1, ps2, psp, wiiu, gba, ds, 3ds (ARM and Thumb), switch, ps4, dc, saturn, genesis | Calls and data checked |
| ps3 (TOC), gamecube-mwcc (r13 small data) | Calls checked; globals are reached through a base register, so their address never appears in the function's bytes and is blanked |
| msvc-x64, xbox-i386 | Not available: COFF objects and no linker that places them at fixed addresses. The build says so |

Attempt and integration lists are public, but the byte comparison inside a diagnostic is not. A missed attempt shows its original-versus-candidate dump to the submitter, the chunk's current holder, and project owners and maintainers; an integration's mismatch hex goes to owners and maintainers. Everyone else gets the same text with the byte lines removed and a note saying who can see them. These endpoints read an optional bearer token; a bad token counts as signed out.

Seed fixtures (`demo`, `sample`, `link`) are described in [apps/api/README.md](../apps/api/README.md#seed-fixtures).

## Capacity

These steps add compile capacity and keep the lease, the digest, and the byte match.

| Step | State |
| --- | --- |
| 1. Route by image | Done. `MATCHD_ROUTES` sends a job to the process for `toolchain.image`. `MATCHD_URL` is the fallback. `docker-yml/docker-compose.matchd-pool.yml` publishes one warm process per image |
| 2. More claimers | Done. `MATCHD_WORKERS` defaults to 4. A claimer waits 2 seconds only when the queue is empty. One worker runs recipe rechecks, and only when no submit is waiting |
| 3. Sandbox the compile | Done inside the image. No network, read-only toolchain, private temp directory, 30 second cap. The container must run with `docker-yml/matchd-seccomp.json` (see `docker-yml/matchd-seccomp.md`). matchd checks the sandbox at startup and exits if it cannot start. Compiler flags are checked against an allow-list per compiler family, and each compile has a 1 GB data cap. A microVM is still open |
| 4. Grow the busy image | Done. `MATCHD_SCALE=docker` starts another local copy when an interactive job has waited 30 seconds, and removes it after the image has been idle. The warm process stays |
| 5. A second site | Next, after the us-east-1 deploy. The writer stays single. See the later section of [architecture.md](architecture.md#later-more-than-one-site) |

## Compilers

How matchd is laid out, and when a console needs a new family, toolchain, or target, is in [architecture.md](architecture.md#matchd-layout).

Each registered compiler below is a public build. Licensed SDK compilers are not installed, and a ROM built with one will not match the public stand-in. Ghidra compiler specs describe calling conventions. They are not these binaries.

Registered images: `host-gcc`, `gba-agbcc`, `ds-gcc`, `3ds-gcc`, `n64-gcc`, `gamecube-mwcc`, `msvc-x64`, `switch-clang`, `ps1-gcc`, `ps2-gcc`, `psp-gcc`, `ps3-gcc`, `ps4-clang`, `xbox-i386`, `wiiu-gcc`, `dc-gcc`, `saturn-gcc`, `genesis-gcc`.

### MIPS

One relocation table covers the family. Each console still has its own compiler image, endianness, and ABI.

| Console | CPU | Compiler | Notes |
| --- | --- | --- | --- |
| Nintendo 64 | R4300i, big-endian | GNU GCC 2.8.1, `ghcr.io/re-hydra/n64-gcc:2.8.1`, `Dockerfile.n64` | `R_MIPS_*` widths are in `families/mips.ts`. `HI16` and `LO16` blank the immediate. `R_MIPS_26` blanks the 26-bit target, so `j` and `jal` still differ. IDO and GCC 2.7.2 are still separate images |
| PlayStation | R3000, little-endian | Debian `mipsel-linux-gnu-gcc`, `ghcr.io/re-hydra/ps1-gcc:mipsel`, `Dockerfile.ps1` | PSY-Q `ccpsx` is a different binary. A little-endian `HI16` blanks the low half of the word. `R_MIPS_26` blanks the `jal` target, keeps its opcode, and leaves the delay slot |
| PlayStation 2 | Emotion Engine, little-endian | Debian `mips64el-linux-gnuabi64-gcc` with `-march=r5900 -msingle-float`, `ghcr.io/re-hydra/ps2-gcc:mips64el`, `Dockerfile.ps2` | Sony `ee-gcc` is a different binary. Objects are ELF64. `R_MIPS_26` keeps the paired `R_MIPS_NONE` records. VU microcode stays out |
| PSP | Allegrex, little-endian | pspdev GCC 15.2.0, `ghcr.io/re-hydra/psp-gcc:allegrex`, `Dockerfile.psp` | The Sony SN Systems compiler is a different binary. `psp-objdump` decodes Allegrex. This compiler does not add paired `R_MIPS_NONE` records. `R_MIPS_GPREL16` blanks a `gp` load |

### PowerPC

CodeWarrior and GCC do not emit the same bytes.

| Console | CPU | Compiler | Notes |
| --- | --- | --- | --- |
| GameCube and Wii | Gekko / Broadway, big-endian | Open `mwcc`, `ghcr.io/re-hydra/mwcc:gc`, `Dockerfile.mwcc` | The Metrowerks SDK is a different binary. `R_PPC_*` widths are in `families/ppc.ts`. `ADDR16_HA` / `ADDR16_LO` blank the immediate. `REL24` blanks the LI field and keeps the opcode and LK bit. `EMB_SDA21` blanks `rA` and the offset and keeps the opcode and `rD` |
| Wii U | Espresso, big-endian | Debian `powerpc-linux-gnu-gcc`, `ghcr.io/re-hydra/wiiu-gcc:powerpc`, `Dockerfile.wiiu` | The Cafe SDK compiler is a different binary. `REL24` blanks the `bl` target and keeps the opcode and LK bit |
| PlayStation 3 | Cell PPE, big-endian | Debian `powerpc64-linux-gnu-gcc`, `ghcr.io/re-hydra/ps3-gcc:powerpc64`, `Dockerfile.ps3` | SNC is a different binary. The function symbol is in `.opd` and `nm` prints it as `D`. `ps3-objdump` passes `-z`. `R_PPC64_REL24` blanks the `bl` target and keeps the opcode and LK bit. SPU code stays out |
| Xbox 360 | Xenon, big-endian | Not registered | `IMAGE_REL_PPC_*` widths and the COFF reader are in place. Debian Clang cannot write PowerPC COFF. libxenon emits ELF. OpenXeChain has no released compiler to pin |

### ARM and AArch64

Thumb and ARM are different instruction streams. The chunk's flags name which one.

| Console | CPU | Compiler | Notes |
| --- | --- | --- | --- |
| Game Boy Advance | ARM7TDMI | `agbcc`, `ghcr.io/re-hydra/agbcc:gba`, `Dockerfile.agbcc` | `R_ARM_*` widths are in `families/arm.ts`. ARM branches keep the opcode byte. Thumb `BL` blanks the immediate bits of both halfwords and the BL/BLX bit. `armcc` is a different image |
| Nintendo DS | ARM9 and ARM7 | Debian `arm-none-eabi-gcc`, `ghcr.io/re-hydra/ds-gcc:arm`, `Dockerfile.ds` | ARM9 is `-march=armv5te`. ARM7 is `-march=armv4t -mthumb`. `mwccarm` and `armcc` are different binaries |
| Nintendo 3DS | ARM11 | Debian `arm-none-eabi-gcc` with `-march=armv6k -mtune=mpcore`, `ghcr.io/re-hydra/3ds-gcc:arm`, `Dockerfile.3ds` | ARM Compiler 5 is a different binary. Hard float is `-mfpu=vfp -mfloat-abi=hard` |
| Switch | AArch64, little-endian | Debian Clang `--target=aarch64-none-elf`, `ghcr.io/re-hydra/clang:switch`, `Dockerfile.switch` | The Nintendo SDK Clang is a different binary. `R_AARCH64_CALL26` blanks the `bl` target and keeps the opcode bits |

### x86

Host `gcc` does not reproduce these bytes. A native Windows C or C++ program uses the same COFF images as the Xbox rows.

| System | CPU | Compiler | Notes |
| --- | --- | --- | --- |
| Windows, 64-bit | x86-64 | Debian Clang, Microsoft x64 COFF, `ghcr.io/re-hydra/clang:msvc-x64`, `Dockerfile.coff` | Same image as Xbox One and Series. Retail Visual C++ is a different binary. `IMAGE_REL_AMD64_REL32` blanks the call displacement |
| Windows, 32-bit, and the original Xbox | Pentium III / x86 | Debian Clang `--target=i686-pc-windows-msvc`, `ghcr.io/re-hydra/clang:xbox`, `Dockerfile.xbox` | Visual C++ 6 and 7 are different binaries. COFF size comes from the disassembly. `IMAGE_REL_I386_REL32` blanks the call displacement |
| Xbox One and Series | x86-64 | The Windows 64-bit image above | Retail Visual C++ is a different binary |
| PlayStation 4 | x86-64 | Debian Clang `--target=x86_64-unknown-freebsd`, `ghcr.io/re-hydra/clang:ps4`, `Dockerfile.ps4` | The Orbis SDK Clang is a different binary. Objects are ELF. `R_X86_64_PLT32` blanks the call displacement |
| PlayStation 5 | x86-64 | Not registered | Prospero Clang is a licensed SDK compiler. The PS4 relocation table applies when the object is ELF |

### Other systems

| Console | CPU | Compiler | Notes |
| --- | --- | --- | --- |
| Dreamcast | SH-4, little-endian | Debian `sh4-linux-gnu-gcc` with `-m4`, `ghcr.io/re-hydra/dc-gcc:sh4`, `Dockerfile.dc` | The Hitachi compiler is a different binary. `dc-objdump` passes `-z`. `R_SH_DIR32` blanks the literal pool. AICA sound code stays out. Windows CE is a separate image |
| Saturn | SH-2, little-endian | Debian `sh-elf-gcc` with `-m2 -ml`, `ghcr.io/re-hydra/saturn-gcc:sh2`, `Dockerfile.saturn` | The Hitachi compiler and the Sega SDK GCC 2.7 compiler are different binaries. C only. Symbols have a leading underscore. A float add calls `___addsf3`. The SCU DSP stays out |
| Genesis / Mega Drive | 68000, big-endian | Debian `m68k-linux-gnu-gcc` with `-m68000`, `ghcr.io/re-hydra/genesis-gcc:68000`, `Dockerfile.genesis` | SN Systems, Sierra C, and the Sega SDK C compiler are different binaries. `R_68K_32` blanks the address after `jsr`. Most Genesis games are assembly. The Z80 stays out |

NES, Game Boy, Game Boy Color, and Super Nintendo games are almost all assembly. `cc65` and GBDK produce different bytes. Cover one of these after a specific game is known to have been built with a specific installable C compiler.

## First deployment

One region, us-east-1, one writer. A second region waits until this site's pool is dull.

The signer builds `endpoint/bucket/key`. A bucket created on AWS rejects that path style. It has to call `https://<bucket>.s3.us-east-1.amazonaws.com/<hash>`, with the host header set to that same name. The content hash, the `blobs` catalog, and the compile job that already carries the bytes stay as they are.

Around the process:

- A private us-east-1 bucket, empty, with public access blocked and server-side encryption on. The local bucket stays on this machine.
- Postgres in us-east-1, migrations applied, seed left unrun. The dev user and `rehydra-dev` password stay local.
- The API and matchd in that same region. `BLOB_STORE=s3`, region `us-east-1`, and an access key that can only put and get objects in that bucket. `MATCHD_TOKEN` has to be a real secret, set on both the API and every matchd process. Neither starts without it, and the images no longer carry a default. `dev-matchd-token` still starts but logs a warning.
- HTTPS on the public API URL. The web app talks to `/v1` on the same origin.
- `API_HSTS=on` once the API is served over HTTPS. The host that serves the web build should also send `X-Frame-Options: DENY` (or `frame-ancestors 'none'`), which a `<meta>` CSP cannot set.
- `MAIL_DRIVER=ses`, `MAIL_FROM` a sender verified in SES (and the account out of the SES sandbox), `SES_ACCESS_KEY` / `SES_SECRET_KEY` allowed only `ses:SendEmail`, and `APP_URL` the public web origin. Password reset links and report alerts to admins both go through it.
- `TRUSTED_PROXIES` set to the load balancer's network, so rate limits see client addresses. Keep `RATE_LIMITS=on`. Rate limits are per API process and in memory, so with several API processes each one counts separately.

`blob_objects` can remain for that first deploy. With `BLOB_STORE=s3` the API does not write it. Drop the table after one checkout and one match have both read from the bucket.

The local copy (`npm run api:blobs`) fills this machine only. Production starts empty.

## Second region

This waits until the us-east-1 pool is dull. The writer stays in us-east-1. The design, the settings that already exist, and the code to write first are in [architecture.md](architecture.md#later-more-than-one-site).

## Next

In this order. The first decides whether re-hydra can match retail games at all. The second and third (both done) make the lease and match code safer to change before the fourth extends what a match checks.

Alongside these, launch work goes on: the us-east-1 deploy (First deployment above) and the open foundations items, agreements before launch and the built CLI before the npm release ([foundations-plan.md](foundations-plan.md)).

### 1. Compilers, and what the law allows

A match needs the compiler that built the game. Every registered image is a public build, and most retail games were built with a licensed SDK compiler: IDO for most N64 games, particular Metrowerks versions for GameCube and Wii, PSY-Q for PlayStation, SN Systems for several consoles. Those are different binaries, so their games will not match today. Real retail matches are realistic only where the community compiler is the one the game used, such as `agbcc` for GBA games built with it.

Questions to settle, with a lawyer:

- Whether the operator may run original compiler binaries in matchd as a service, which ones, and on what terms. Running a binary on a server and handing it out are different questions.
- If some may only run on a contributor's own machine: the proof would then be a claim anyone with the compiler can recheck, not a server-side match. Decide whether the site accepts that, and how it marks such matches.
- For each console, which compilers its games were built with, and how to tell from the binary.

The result is a list of compilers per target with the legal basis for each. matchd already pins a new binary with a new toolchain file and target (see [architecture.md](architecture.md#matchd-layout)).

### 2. One module for chunk state

Done 2026-11-26. Before it, eight services wrote chunk state and `chunk_leases` directly, and account deletion, blocking a user, and removing a member went through a shared helper. Each caller had to keep the lease columns consistent with the state (the `chunks_check1` constraint), lock the row, and recount the board afterwards. Audit findings A-001, A-003, and A-004 came from that, and account deletion's first version broke `chunks_check1`.

Now `ChunkState` (`apps/api/src/services/ChunkState.ts`) owns every transition: checkout, competing lease, heartbeat, release, clear, expiry, submit, match, miss, a job ending with no result, going stale, fuse, and block or unblock on an unresolved type, plus ending all of one user's leases. Each method runs in the caller's transaction, acts only from the states it names, writes the whole lease column set at once, and recounts the project it changed (bulk methods recount each project once). Callers keep their own locks, refusals, activity events, attempts, jobs, and match rows.

`chunkStateWrites.test.ts` fails on a write to a chunk's state, lease, current match, or fuse parent, or to `chunk_leases`, anywhere else. Updates to other chunk columns (names and bytes on import, the type revision on a proposal, language and inline assembly settings) stay where they were. The sweeper still recounts recently changed projects every tick, the backstop for concurrent recounts (A-016).

### 3. Unit tests for the lease and match rules

Done 2026-11-26. Before it, the lease rules were tested only end to end: the verify scripts need the API, Postgres, and often matchd, and some wait on the sweeper.

Now `chunkState.leases.db.test.ts` and `chunkState.matches.db.test.ts` (28 tests, about a second) call each `ChunkState` method directly against Postgres. Each test runs in a transaction that is rolled back; the harness is `apps/api/src/testing/db.ts`. They cover:

- which states each transition accepts and what it refuses, and the lease columns after it;
- competing leases: the `max_concurrent_leases` limit, one per user, promotion of the oldest live one, a competing holder who submits;
- heartbeats, misses, and expiry by the database clock: `lease_hours`, the `max_hold_hours` cap, never shortening a lease (A-010, A-023);
- a result applying once and only to its own lease (A-001), one submission in flight (A-002), a job with no result and the five-minute backstop (A-004);
- going stale, inline assembly, integration reopens, unresolved types, fuse;
- the board counts matching a fresh count after each change.

`npm run verify` runs them first, on its fresh database, before it starts the API, so CI's verify job runs them too. By hand: `TEST_DATABASE_URL=<a migrated database> npm run test:db -w @re-hydra/api`. The per-user hold cap is in `ChunksRepo.checkout`, not `ChunkState`, so `verify-checkout-loop` still covers it.

### 4. Matching beyond one function

An isolated match compares the function's code bytes. Every place the code refers to something else is masked, so the read-only data it uses (a `switch` statement's jump table, float constants, strings) is not compared. The integration build places matched functions at their addresses and defines known globals, but blanks what it cannot place and never compares data. Nothing compares the whole program. These steps close that, each building on the last. [splat](https://github.com/ethteck/splat) (splitting a program into files and sections) and [objdiff](https://github.com/encounter/objdiff) (comparing objects per section) are the community tools to learn from.

1. **Read-only data per function.** The Ghidra export includes the jump tables and constants each function reads, with their bytes. The match compares those bytes too instead of masking the reference. Imports without them keep today's check.
2. **Data chunks.** A chunk for a global table or struct. The contributor writes the C initializer and matchd compares the compiled data with the original bytes. Checkout, leases, and proof work as they do for functions.
3. **Files.** A project-level split map says which address ranges were one source file. The integration build compiles per file, with its static functions, function order, and flags, instead of one function per compile.
4. **The whole program, checked locally.** The server keeps only the program's hash, by design (content policy), and that does not change. `hydra build` compiles the project's files with its split map and linker script and compares the result with the contributor's own copy of the program. The site records the output hash and compares it with `binaries.sha256`, which it already stores.

**Leases.** The lease stays on one chunk: a function or, after step 2, one data item. Nothing larger is leased. A file lease would let one person hold a hundred functions for two days. Checks above one chunk run over what has already matched, the way the integration build does today.

- Read-only data a function alone uses belongs to its chunk, so its lease covers it. Bytes two functions share (a common string, a file's constant pool) belong to neither lease; the isolated match leaves them out and the file build checks them.
- A data chunk is a chunk of another kind, with the same checkout, heartbeat, submit, expiry, and hold cap.
- What makes up a file (the split map, function order, the file's flags, its static variables and shared declarations) is shared project state, like `types.h`. It changes through proposals that a maintainer accepts, not through a lease. A checkout includes the file's shared declarations, so a function's isolated compile sees the same context as the file build.
- The file build runs once a file's chunks have all matched, or when a maintainer starts it, using each chunk's matched source. When it disagrees with a chunk that matched alone (static functions, inlining, or order can change the code), that chunk reopens with the byte comparison, as an integration miss does today with `integration.txt`. Functions that only match together are fused into one chunk with one lease, as today.
- The whole-program check takes no lease. A reported hash proves nothing by itself, since anyone can report the original hash without building. Record each report with its account and the exact source revision, and mark the program matching only after independent confirmations from different accounts (or accounts the maintainers trust).

## Still open

- Foundations: agreements (the rest of item 3), a built CLI package, shared rate limits, and smaller fixes. Each with its likely reason and a plan in [foundations-plan.md](foundations-plan.md).
- A second site, after this site's pool is dull. The writer stays single.
- matchd capacity: a per-container ceiling, a production scaler, and cold images ([matchd-scaling.md](matchd-scaling.md#what-to-fix-in-order), items 4–6).
- A microVM sandbox. The image sandbox, the flag allow-list, and the 1 GB per-compile data cap are the boundary that runs today.
- Xbox 360 and PlayStation 5, until a public compiler emits the retail object format.
- Retail SDK compilers: Next, step 1.
- What happens to member matches if a fused chunk is later split. Split is not implemented.
- The policies in [policy/](policy) are drafts that need legal review and their bracketed decisions. Still open from the content policy's checklist (its section 6): a registered DMCA agent and contact addresses. Sign-up asks only for the content policy; the agreements table is foundations plan 3. The known-malware check needs an abuse.ch Auth-Key set in production.
- Long term: check function bytes against malware signatures (for example YARA rules or byte patterns from public feeds). Today only the whole program's reported hash is checked, so a malware sample exported under a false hash, or a program whose functions share code with known malware, gets through. Bytes are stored per function, so a scan could run at import and again when the rules change.
- The object signer still uses path-style URLs. The first-deployment section is the us-east-1 cutover. `blob_objects` stays until a checkout and a match have both read from the bucket.
- The CLI does not follow, search, change project settings (lease cap, language, access), manage members, or use the discussion.
- Integration compiles each matched function as its own translation unit (per-file builds are Next, step 4). It does not search for a flag set.
- A profile's follower count refreshes when the page reloads.
