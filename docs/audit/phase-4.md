# Audit phase 4: security

Status: review done 2026-11-23 on branch `audit/phase-4-security`, off `main` at `d2d49ec21`. A-032 was fixed afterwards on the same branch (see [changelog.md](changelog.md)). The other findings below are open. Plan: [plan.md](plan.md). Findings: [findings.md](findings.md).

## Method

- Read the auth middleware, every endpoint in `apps/api/src/Api.ts`, and the role check behind each write.
- Read sign-up, sign-in, sessions, and access tokens (`AuthRepo.ts`, `auth/password.ts`).
- Scanned the web app for raw-HTML sinks, `href`s built from data, token storage, and zip entry names.
- Read the CLI config writer, blob storage and S3 signing, and every matchd Dockerfile. Ran `npm audit`.
- Live tests:
  - The sandboxed matchd (`127.0.0.1:3001`), with hostile jobs posted using the dev token.
  - A test API on the throwaway `rehydra_audit` database: rate limiting, body size, CORS, and response headers.

## What holds

| Area | Result |
| --- | --- |
| Role checks | Every privileged write checks the role it needs: settings, import, fuse, clear lease, chunk language, unresolved types, recheck, accept, integration. Checkout, submit, heartbeat, and release need only a signed-in user, by design (A-012) |
| Data across users | The work bundle requires holding the lease, so another user's best attempt source is not exposed. Token revoke is scoped to the owner. Public profiles and people search never return email |
| Sign-in | 32-byte random tokens, stored as SHA-256. scrypt password hashes. An unknown email is checked against a dummy hash, so timing does not reveal accounts. One generic error message. Changing the password revokes sessions. Sessions last 30 days |
| CORS | A preflight from another origin gets 404 with no CORS headers. Browsers block cross-site calls, which is right for the same-origin deploy |
| Web app | No `dangerouslySetInnerHTML`, `innerHTML`, or `eval`. React escapes all text. Zip entry names are fixed constants, and the download name is sanitized |
| Blobs | S3 keys are hex digests computed on the server. Reads check the hash. Blobs are never served directly to browsers |
| Scaler | Starts only images from a fixed map (`localMatchdImage`). The image string is never passed to `docker` |
| matchd input | The entry symbol is only used to parse objdump and nm output, never as a command-line argument |
| Sandbox isolation | From inside a compile: only `lo`, DNS fails, its own process table (6 pids), read-only root |
| Dependencies | `npm audit`: 0 vulnerabilities |

## Findings

| Id | Severity | Finding | Evidence |
| --- | --- | --- | --- |
| A-032 | **Critical** | Inline assembly forges a match. A contributor submits `__asm__(".byte …")` with the original bytes from their own bundle and gets a "normalized byte match" with no translation | Live: original `mov rax,12345; ret`, a source with no C at all, result `matched=true`. Nothing in the API or matchd rejects `asm` |
| A-013 | High (now CONFIRMED) | Owner-chosen compiler flags run code and read files inside the sandbox. `-wrapper /bin/sh,-c,…` ran a shell as uid 0 in the sandbox namespace. `@/etc/passwd` echoed the file into diagnostics. Any account can create a project and set flags | Live, both. Contained by the sandbox (no network, read-only), but there is no memory cap, and more kernel surface is exposed |
| A-034 | High | No request body limit on the API or matchd. Effect's `MaxBodySize` defaults to unset | Live: a 60 MB body to `/auth/sign-up` (no auth) was uploaded and parsed. The response was 400 for the password, not 413 |
| A-035 | High | No rate limiting anywhere. Sign-in is a scrypt call each time, sign-up has no limit or verification, and unlimited accounts make lease hoarding (A-012) cheap | Live: 30 wrong-password sign-ins in 3.1 s, all 401, none 429 |
| A-036 | Medium | The work bundle goes to the contributor's AI agent, but most of it comes from other people: the owner's pseudocode, disassembly, and names; earlier contributors' attempts; proposed headers. `instructions.agent` does not say these files are untrusted. The imported function name (any string, newlines allowed, no length limit) is pasted into the instructions text itself | Code: `domain/agentInstructions.ts`, `domain/Import.ts` (`name: Schema.String`) |
| A-033 | Low | Any contributor's source can `#include` files from the matchd container and see them in diagnostics. The sandbox mounts the whole container root read-only | Live: `#include "/etc/hostname"` printed the container id |
| A-037 | Low | No security headers. The web app keeps the session token in `localStorage` and has no Content-Security-Policy as a second line of defense | Live: `/v1/health` returns no CSP, `X-Content-Type-Options`, or frame headers |
| A-038 | Low | The CLI writes `config.json`, which holds the token, with default permissions: readable by other local users on Linux and macOS | `apps/cli/src/config.ts:61` |
| A-039 | Low | Supply chain floats in three places: `node:22-*` base images by tag, the N64 GCC tarball with no checksum, and rustup `stable` through `curl \| sh` for mwcc. Git sources are pinned by commit and PSP by sha256 | `apps/matchd/Dockerfile*` |
| A-040 | Low | scrypt `N=16384` is below current guidance (2^17). Sign-up's "email taken" reveals which emails have accounts | `auth/password.ts`, `AuthRepo.signUp` |

Also noted: proposing a type requires at least the `contributor` role. No one can be given that role (A-011), so today only owners can propose types.

## Fix order

1. **A-032 (needs your call).** Should inline assembly ever count? Some original game code really is inline assembly, for example PS2 VU or COP2 sequences. My recommendation:
   - matchd rejects `asm`, `__asm`, and `__asm__` in the preprocessed source by default;
   - an owner can allow it per chunk;
   - matches that use it are marked on the board and in the match record.
2. **A-034 and A-035 (no decision needed):**
   - set `MaxBodySize` on the API (a few MB, with a larger limit only on the import route) and on matchd;
   - add per-IP and per-account rate limits for sign-in and sign-up, plus a per-account cap on new projects and checkouts per hour.
3. **A-013 (with the A-013 decision):** an allow-list of flags per toolchain, which rejects `-wrapper`, `@file`, `-B`, `-specs`, `-fplugin`, `-o`, and `-include`. Add a memory cap per compile (`prlimit --as`), which the roadmap already lists.
4. **A-036:** validate imported names as C identifiers (with a length limit), and tell the agent that the bundle files are data, not instructions.
5. **The rest:** A-033 (mount only the toolchain directories, or `-nostdinc` plus fixed include paths), A-037 (CSP and headers wherever the web app is served), A-038 (`mode: 0o600`), A-039 (pin by digest and checksum), A-040.

## Not covered

- A full fuzz of the objdump and nm parsers with hostile object files. Phase 6.
- Memory exhaustion inside a compile. Known open: there's no resident-memory cap. I did not run it, because it would stress the shared Docker VM.
- The production hosting of the web app (headers, TLS). Nothing is deployed yet.
