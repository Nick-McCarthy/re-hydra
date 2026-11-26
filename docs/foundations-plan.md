# Foundations plan

Decisions that would be made differently in a new project, why they were probably made this way here, and what to do about each now. The reasons come from the code, the migrations, the audit documents, and the git history. Where the evidence only suggests a reason, the text says "probably".

The project is four weeks old (first commit 2026-10-28). Milestones 1–4 came first, the audit second (2026-11-22 to 24), and the content policy last (2026-11-24 and 25). Most items below follow from that order: the mechanism was proven first, and the rules around it were added after.

## Summary

| # | Item | Verdict | When | Size |
| --- | --- | --- | --- | --- |
| 1 | Errors without a reason | Done | — | M |
| 2 | Tokens can do everything | Done (expiry still open) | — | M |
| 3 | Account deletion and agreements | Deletion and display name done; agreements open | Before launch | M |
| 4 | Policy written after the features | Process; mostly caught up | Ongoing | S |
| 5 | CLI runs from TypeScript source | Change | Before npm publish | M |
| 6 | Rate limits in memory | Keep for one API process | Before a second API process | M |
| 7a | Line endings | Done | — | S |
| 7b | Addresses as decimal strings | Keep the type, add hex | Any time | S |
| 7c | Google Fonts | Done | — | S |
| 7d | Tests run by hand | Done | — | M |

Done items keep only why they were the way they were and what changed; the full analysis is in git history. Next: the rest of 3 (agreements), then 5 and 7b together when the npm release is near.

---

## 1. Errors that say why

**Done.** Every bare `Conflict` and `BadRequest` became an `HttpApiError.Problem` in `apps/api/src/domain/Problems.ts` with a `reason` and a `detail`; `chunkRefusals.ts` explains why a lease operation found nothing to change; `Problems.test.ts` fails on a new bare error; the CLI shows the server's detail instead of guessing. What clients see is in the roadmap ("Refusals say why").

**Why it was like this.** Bare errors are the zero-effort default, and the first client (the web app) was written alongside the API, so it knew why a call could fail. The `Problem` classes arrived where a person needed a specific message: sign-in, suspension, the checkout limit.

**Still true.** Answers that must not reveal whether an account exists (password reset, and sign-up per A-040) stay vague on purpose; do not add a reason to them. Projects are all publicly visible, so `NotFound` hides nothing today; that changes if private projects are added.

## 2. Scoped tokens

**Done (migration 027), with two scopes instead of three.** `access_tokens.scope` is `work` or `all`. A separate `maintain` scope would only have differed from `all` by excluding account settings, and nothing needs that yet. The check is an allow-list in the Authorization middleware (`AllowWorkToken` in `Api.ts`), so new endpoints are closed to agents by default. What users see is in the roadmap ("Profile tokens have a scope").

**Why it was like this.** Migration 011 added tokens so the CLI could survive a password change. At the time a person ran every command, so scopes only mattered once the agent skill let something else hold the token.

**Still open.** An expiry on tokens (`expires_at`), with 90 days as the default for new ones.

## 3. Account deletion and agreements

**Done: deletion and display-name change (migration 028).** What users see, and the rules (owners archive or hand off first, work stays as "deleted account", strikes kept against an email hash), are in the roadmap and the privacy policy; the foreign-key rules are in the schema's migration 028 section. The shared code is `apps/api/src/services/accountDeletion.ts`, checked by `verify-account-deletion.mjs`.

**Why it was like this.** Migrations 001–008 were the core mechanism (claim, match, prove), written before accounts had a lifecycle, so their references to `users` had no `ON DELETE` rule. By migration 015 deletion was being thought about, which is why later tables chose deliberately. 3a was a bug in that gap: strikes cascaded, so deleting an account reset its strikes. Migration 026 made it `RESTRICT` until deletion could keep a hash of the email.

**Still open: agreements.** Sign-up records one agreement, for the content policy only (`users.policy_version`, `policy_accepted_at`). Plan: a table `agreements (user_id, document, version, accepted_at)` for content policy, terms, and privacy; backfill the existing columns into it; sign-up asks for all three; when a document's version changes, ask signed-in users to accept it again.

## 4. Policy before features

**Today.** Mostly caught up: rights confirmation on import, the CC0 licence, strikes, reports, admin tools, and the malware check are built; whole-program upload (`binaryBase64`, present since 2026-11-02) was refused on 2026-11-25. Terms and privacy are drafts.

**Why.** A prototype proves the mechanism before anyone writes rules for it, and the policy work began once a public launch was planned.

**Plan.** This is a habit, not code:

1. Every new feature that stores or shows user content gets a line in the design (roadmap or the PR) answering: who can see it, how long it is kept, what happens on account deletion, and which policy section covers it.
2. Keep content policy section 6 as the checklist, and add the privacy retention table to it.
3. Get the legal review of all three documents done before launch, and fill the bracketed decisions.

## 5. The CLI as a built package

**Today.** `apps/cli/package.json` has `"bin": { "hydra": "./src/main.ts" }` and is `private`. The CLI imports the API's TypeScript source through the workspace (`@re-hydra/api/Api`, `@re-hydra/api/http/Authorization`, `@re-hydra/api/domain/Bundle`; the API package exports `.ts` files). The skill file is found relative to `src/`.

**Why it is probably like this.** Importing the API's `HttpApi` definition gives the CLI a fully typed client with no code generation, which is a real strength of Effect `HttpApi`. Inside the monorepo, `tsx` runs it directly, so a build step was never needed.

**Plan.**

1. Keep the shared `Api` definition. Bundle it instead of publishing the API: build the CLI with `tsup` or `esbuild` into `dist/main.js`, inlining `@re-hydra/api`'s domain and API modules, with `effect` and `@effect/platform-node` as runtime dependencies.
2. Check that bundling pulls in only schema and API definitions, not the API's services or `@effect/sql-pg`. If it pulls in too much, move `Api.ts` and the domain schemas into a small `packages/api-spec` workspace that both the API and the CLI depend on.
3. `package.json`: `bin` → `dist/main.js` with a `#!/usr/bin/env node` banner, `files: ["dist", "skill"]`, and the skill path resolved from `dist/`.
4. A smoke test that packs the CLI (`npm pack`), installs the tarball in a temp folder, and runs `hydra --help` and `hydra skill print`.
5. A config test for the `--url` case that went wrong: run a command without `--url` and check the saved URL is unchanged.

## 6. Shared rate limits

**Today.** Fixed-window counters in memory, per API process (`apps/api/src/http/rateLimit.ts`, audit A-035). The file's own comment says several processes multiply the limit and a second site needs Redis or Postgres.

**Why.** It was a High audit finding fixed in a day, for a deployment that runs one API process in one region. In-memory is correct for that, and the trade-off is written down.

**Plan.** Keep it while there is one API process. Before running a second one:

1. Move the counters to Postgres: `rate_limits (key text, window_start timestamptz, count int, PRIMARY KEY (key, window_start))` with `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`, and a sweep of old windows. Postgres is already there; Redis would be one more service to run.
2. Keep the same `RateLimiter` interface so routes do not change, and run the existing `rateLimit.test.ts` against both stores.

## 7. Smaller things

### 7a. Line endings

**Done.** `.gitattributes` sets `* text=auto eol=lf` (`*.bat`/`*.cmd` CRLF, binaries marked), so checkouts are LF whatever a machine's `core.autocrlf` is. The repo is edited on Windows and had no `.gitattributes`; `autocrlf` hid the mix. `apps/matchd/Dockerfile.ps1` is the PlayStation image, not PowerShell, so `.ps1` stays LF.

### 7b. Addresses as decimal strings

**Today.** `chunks.address` is a Postgres `bigint`; the API sends `String(row.address)`, so `4198400` instead of `0x401000`. The CLI converts it back to hex in several places.

**Why.** This one is right. Node's Postgres driver returns `int8` as a string because a JavaScript number cannot hold every 64-bit value exactly, and targets such as PS3 and Switch have 64-bit addresses. A string is the safe type.

**Plan.** Keep the string, and change its format: send hex (`"0x401000"`) everywhere, accept hex or decimal on input, and document it in the schema. This is a breaking API change for the web and the CLI, so do it before the npm release (item 5), in one change with both clients.

### 7c. Google Fonts

**Done.** IBM Plex Sans and Mono come from `@fontsource`, bundled by Vite and served by the site; the production CSP allows only `'self'` for styles and fonts, and the privacy policy no longer mentions Google. They had been loaded from Google as the quickest way to get the typeface, and A-037's CSP was written to allow what was already there.

### 7d. One test runner, in CI

**Done.** `npm run verify` runs every end-to-end script on a fresh database, and GitHub Actions runs it with typecheck, unit tests, and the web build (how it works: the roadmap). Three scripts stay manual: `verify-flags` (every compiler image) and `verify-phase3` and `verify-small-fixes` (the `scale100k` project). The scripts were written during the audit, each run once by hand against an API on port 3100, so nothing ran them together.

---

## What to keep

These were good decisions and the plan does not touch them: Effect `HttpApi` shared between the API and its clients; Postgres as the one store, with the lease on the `chunks` row; matchd as a separate, token-guarded service; token, session, and reset secrets stored only as hashes; `instructions.agent` as fixed server text (A-036); content-addressed blobs; and the audit's habit of writing down each trade-off where it is made.
