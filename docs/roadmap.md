# re-hydra roadmap

Milestones 1–4 are done. Compiler images through Genesis are registered. Match capacity on one site is in place through an extra copy of a busy image. The next capacity step is a second site, which is still design. How the system runs is [architecture.md](architecture.md). The tables are [db-schema/schema.md](db-schema/schema.md).

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

Content policy enforcement (migration 022). Sign-up requires agreeing to the content policy and records which version. The import form has three rights confirmations; the API refuses an import without `rightsConfirmed=true` and records who confirmed. Signed-in users can report a project, a function (chunk dialog), or a post, choosing copyright, malware, abuse, or other; 10 reports an hour. Site admins have `/admin`: the report queue, archive and restore projects, remove posts, suspend and restore accounts, and the record of every action. Each action needs a note and is written in the same transaction as the change. Suspending signs the account out everywhere and revokes its access tokens; a suspended account cannot sign in. Admins are granted only from the command line (`npm run api:admin -- grant <email>`, `revoke`, `list`), so a stolen admin session cannot make more. `/policy` shows sections 1–5 of [content-policy.md](content-policy.md), linked from the footer, sign-up, and import. Imports no longer accept the whole program (`binaryBase64`); only its hash is kept, and the link fixture's ELF lives in `fixtures/link/link.elf` for matchd's tests. Checked by `apps/api/scripts/verify-moderation.mjs`.

Site admins are emailed about new reports (migration 023). Every `REPORT_NOTIFY_SECONDS` (default 60) a worker claims reports nobody has been told about, sends each active admin one email listing them (reason, project, function or post, an excerpt, a link to `/admin`), and marks them notified in the same transaction. A burst of reports is one email. A failed send leaves the batch for the next tick; with no admin, reports wait and the API logs a warning each tick. Several API processes never mail the same report (`SKIP LOCKED`). Reports filed before migration 023 count as already notified. Checked by `apps/api/scripts/verify-report-emails.mjs`.

Submitted source is released under CC0 1.0 (policy 2.4, migration 024). The work dialog says so under Submit, `hydra submit` prints it, the agent instructions tell the agent to write the source itself, and each attempt records `source_license` (earlier attempts have none). Repeat infringers (policy 2.5 and 3): admins add a strike with a note on the Users tab, or reverse one with a note, and both go in the record. A strike counts for 12 months unless reversed; the Users tab shows each account's active count and flags three, the point at which the policy says close the account. Suspending stays a manual step, so a counter-notice can be handled first. Checked by `apps/api/scripts/verify-moderation.mjs`.

Known-malware check (policy 4.3, migration 025). A worker downloads a SHA-256 list (`MALWARE_HASHLIST_URL`, MalwareBazaar by default, with `MALWARE_HASHLIST_AUTH_KEY`) every `MALWARE_HASHLIST_REFRESH_HOURS` (default 24); plain text, ZIP, gzip, and CSV all parse. A failed or empty download keeps the old list and is retried after an hour. An import whose program hash is listed is refused before anything is stored, and recorded as a hit. After each refresh, programs already on the site are checked again; a newly listed one is a hit, and its project stays up until an admin decides. Admins are emailed about hits (`MALWARE_NOTIFY_SECONDS`, default 60) and work them on the Known malware tab of `/admin`: confirm, archive the project, or allow (a false positive: the hash is never matched again). Both decisions go in the record. Without a URL nothing is downloaded. The check sees only the hash the export reports. Checked by `apps/api/src/services/malwareList.test.ts` and `apps/api/scripts/verify-malware-hashes.mjs`.

The CLI covers the work loop. `hydra next` takes the first (or `--smallest`) open chunk; `checkout`, `show`, and `attempts` accept a chunk's name or address as well as its id. `hydra status` lists your leases with their folders (kept in `leases.json` beside the config) and time left. `hydra refresh` downloads the bundle again and keeps `candidate.c`. `hydra submit` waits up to `--wait` seconds and, on a miss, prints the first differing byte and the bytes around it (`byteDiff` in `--json`). Failures print one line, and exit codes tell scripts and agents what happened: 2 not a match, 3 still checking, 4 not signed in, 5 no lease, 6 nothing open. The CLI now sends its token on public endpoints too, so a submitter sees their own byte comparison, and `--url` is saved only when given (a default used to overwrite the URL a login saved). Checked by `apps/cli/src/byteDiff.test.ts` and by hand against the link fixture.

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

Seed fixtures:

| Slug | What it is |
| --- | --- |
| `demo` | One chunk, `parse_header`, a single `ret`. An empty function under `-O2` can match |
| `sample` | `skip_space`, `header_size`, and `parse_header` compiled together. An isolated resubmit of `parse_header` will not match. The leaves can |
| `link` | `leaf` and `caller` linked at `0x401000` and `0x401040`. `decoy` can match in isolation and then fail the integration build |

## Capacity

These steps add compile capacity and keep the lease, the digest, and the byte match.

| Step | State |
| --- | --- |
| 1. Route by image | Done. `MATCHD_ROUTES` sends a job to the process for `toolchain.image`. `MATCHD_URL` is the fallback. `docker-yml/docker-compose.matchd-pool.yml` publishes one warm process per image |
| 2. More claimers | Done. `MATCHD_WORKERS` defaults to 4. A claimer waits 2 seconds only when the queue is empty. One worker runs recipe rechecks, and only when no submit is waiting |
| 3. Sandbox the compile | Done inside the image. No network, read-only toolchain, private temp directory, 30 second cap. The container must run with `docker-yml/matchd-seccomp.json` (see `docker-yml/matchd-seccomp.md`). matchd checks the sandbox at startup and exits if it cannot start. Compiler flags are checked against an allow-list per compiler family, and each compile has a 1 GB data cap. A microVM is still open |
| 4. Grow the busy image | Done. `MATCHD_SCALE=docker` starts another local copy when an interactive job has waited 30 seconds, and removes it after the image has been idle. The warm process stays |
| 5. A second site | Next, after the us-east-1 deploy. The second-region section lists the API code, then a replica, a bucket copy, and a matchd pool. The writer stays single. See the later section of [architecture.md](architecture.md) |

## Compilers

matchd grows as three directories: `families/` (relocation widths), `toolchains/` (how a compiler is pinned), and `targets/` (one registered image). A console is a new family when the relocation names are new, a new toolchain file when the driver is not GCC, and a new target once a compiler the operator can ship emits that object format. A target that supports integration builds also names its linker (`tools.ld`, plus `ldFlags` when needed).

Licensed Nintendo, Sony, Microsoft, ARM, Metrowerks, and Hitachi SDKs are not installed. Each registered compiler below is a public build. The retail SDK compiler is a different binary, so a ROM built with the SDK will not match this one. Ghidra compiler specs describe calling conventions. They are not these binaries.

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

A microVM sandbox, Xbox 360, PlayStation 5, fuse-split, and another region wait. A public site also needs the policy for copyrighted software and malware. The draft is [content-policy.md](content-policy.md); its last section lists what the product must do before it is published.

## Second region

This waits until the us-east-1 pool is dull. The writer stays in us-east-1. How the sites fit is the later section of [architecture.md](architecture.md).

These destinations are already settings:

- `MATCHD_URL` and `MATCHD_ROUTES` can send a compile to a matchd process in another region. The job already carries the source and the original bytes, so that worker does not read the bucket.
- `BLOB_S3_ENDPOINT`, `BLOB_S3_BUCKET`, and `BLOB_S3_REGION` name one bucket.
- `DATABASE_URL` names one database.
- `projects.home_region` is stored and shown. Nothing routes a request by it.

`MATCHD_SCALE=docker` starts another container on the local Docker daemon. That copy is the busy-image step. A site in another region is a matchd process running there.

Code before a second site behaves as designed:

- Two database clients. Checkout, submit, heartbeat, match commit, and expiry use the us-east-1 writer. Board and profile reads can use the replica in the API's region. The checkout response the client shows is the writer's response.
- Blob reads try the bucket in the API's region, then the us-east-1 bucket when the object is not there yet. Puts stay on the us-east-1 bucket.
- A signed download URL for a work bundle, with that same fallback. Today the API loads the bytes through the single endpoint and sends them on.

After that code, the new region is a Postgres replica, a replicated bucket, a matchd pool with the same image digests, and an API pointed at those three.

A project whose writer lives in Europe is a further change. The API would send that project's writes to its own writer, and only one writer may grant a lease for a chunk.

## Still open

- A second site, after this site's pool is dull. The writer stays single. The second-region section lists the code and the settings.
- A microVM sandbox. The image sandbox, the flag allow-list, and the 1 GB per-compile data cap are the boundary that runs today.
- Xbox 360 and PlayStation 5, until a public compiler emits the retail object format.
- Retail SDK compilers. They stay unregistered.
- What happens to member matches if a fused chunk is later split. Split is not implemented.
- The content policy is a draft ([content-policy.md](content-policy.md)). It needs legal review. Still open from its checklist: a registered DMCA agent, contact addresses, and separate terms of use. The known-malware check is built but needs an abuse.ch Auth-Key set in production.
- Long term: check function bytes against malware signatures (for example YARA rules or byte patterns from public feeds). Today only the whole program's reported hash is checked, so a malware sample exported under a false hash, or a program whose functions share code with known malware, gets through. Bytes are stored per function, so a scan could run at import and again when the rules change.
- `fixtures/link/dogfood.mjs` expects decoy to match in isolation. Since the call-target check it does not, so the script stops at decoy.
- The object signer still uses path-style URLs. The first-deployment section is the us-east-1 cutover. `blob_objects` stays until a checkout and a match have both read from the bucket.
- Ghidra import is a JSON upload on the project page (web) or a POST to the API. The CLI cannot import.
- The CLI does not propose types, follow, search, change the lease cap, pin a language, or start an integration build.
- Integration compiles each matched function as its own translation unit. It does not search for a layout or a flag set.
- A profile's follower count refreshes when the page reloads.
