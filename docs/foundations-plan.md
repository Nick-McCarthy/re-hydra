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
| 7d | Tests run by hand | Done (CI not yet seen running) | — | M |

Suggested order: 7a, 3a, 1, 2, 7c, and 7d (done), then 3, and 5 when the npm release is near.

---

## 1. Errors that say why

**Done.** `apps/api/src/domain/Problems.ts` holds the problems; `chunkRefusals.ts` explains why a lease operation found nothing to change; `Problems.test.ts` guards against new bare errors. The CLI's guessing is gone. The rest of this section is the analysis it was based on.

**Today.** The API returns bare `HttpApiError` classes in most places: `new Conflict()` 42 times, `new BadRequest()` 6, `new Forbidden()` 10, `new NotFound()` 77. Sixteen errors already use the better pattern, `HttpApiError.Problem` (RFC 9457 problem details with a `type` URL and a title): `CheckoutLimited`, `ProjectAccessDenied`, `DiscussionRefused`, `SignInLimited`, and the auth errors. `IntegrationsRepo.start` alone returns a bare `Conflict` for five different causes (fewer than two matches, duplicate names, a build already running, a recipe check running, mixed languages). The CLI guesses between them.

**Why it is probably like this.**

- Bare errors are the zero-effort default in `HttpApiError`, and the first client was the web app, written alongside the API, so it knew which call could fail and why.
- The `Problem` classes arrive where a person needed a specific message: sign-in, sign-up, suspension, the checkout limit (git: first used in the matchd scaling work and widened in audit phase 4).
- Some vagueness is deliberate: password reset does not reveal which emails have accounts (`PasswordResets.ts`, audit A-040). Those answers must stay vague. Projects are all publicly visible (members-only limits who may check out, not who may look), so `NotFound` hides nothing else today; that changes if private projects are added.

**Plan.**

1. Keep the answers that must not reveal whether an account exists (password reset, and sign-up per A-040's decision). Mark them in a comment so nobody adds a reason later.
2. Replace each bare `Conflict` and `BadRequest` with a `Problem` per cause, or one `Problem` per endpoint with a `reason` code. `Problem` already carries an optional `detail` string. For example `IntegrationRefused` with reason `too_few_matches`, `duplicate_names`, `build_running`, `recipe_check_running`, `mixed_languages`.
3. Start with the endpoints agents and the CLI use: checkout, submit, heartbeat, release, integrate, type proposal accept and recheck, import.
4. Delete the guessing in the CLI (`explainFailure`'s generic Conflict text, the integrate and accept fallbacks) once the server names the reason. Show the server's `detail` instead.
5. Add a lint-style test: no bare `new Conflict()` in `apps/api/src/services`.

## 2. Scoped tokens

**Done, with two changes from the plan below.** Migration 027 adds `access_tokens.scope` (`work` or `all`; existing tokens are `all`, new ones default to `work`). There are two scopes, not three: a separate `maintain` scope would only differ from `all` by excluding account settings, and nothing needs that yet. The check is in the Authorization middleware as an allow-list: an endpoint a work token may call is annotated `AllowWorkToken` in `Api.ts` (18 of them), so a new endpoint is closed to agents by default. A refused call is a 403 `TokenScopeRefused` with a detail. The profile page picks the scope and shows it on each token. Token expiry (step 5) is not done.

**Today.** `access_tokens` (migration 011) has a label, a hash, and revocation. A token has the full power of its owner. `hydra integrate --confirm-cost` is the only thing between an agent and a costly build, and it is a client-side check.

**Why it is probably like this.** Migration 010 replaced magic-link sign-in with passwords. The CLI then needed a credential that survives a password change, and 011 added one (schema-reasoning: "they stay valid across a password change until revoked"). At the time a person ran every command, and `instructions.agent` told the agent to stop before submitting. Scopes only matter once something other than the person holds the token, which became true with the agent skill.

**Plan.**

1. Migration: `access_tokens.scopes text[] NOT NULL DEFAULT '{all}'`. Existing tokens keep full power.
2. Define a few scopes, not one per endpoint: `work` (list, checkout, submit, heartbeat, release, attempts, propose types, mark unresolved), `maintain` (integrate, accept and recheck proposals, import, project settings, members), `all`.
3. Check the scope in the authorization middleware (`AuthorizationLive.ts`), next to the role checks. Sessions from the browser are always `all`.
4. Profile page: choose scopes when creating a token; default `work`. `hydra skill install` and the FAQ tell people to give agents a `work` token.
5. Optionally an expiry on tokens (`expires_at`), with 90 days as the default for new ones.
6. Then `--confirm-cost` can stay as a courtesy, and the real control is the server refusing `integrate` to a `work` token.

## 3. Account deletion and agreements

**Today.** There is no account deletion and no display-name change. The foreign keys to `users` show two eras:

- Migrations 001–008 (projects, attempts, matches, imports, type revisions, proposals, `project_events`, integrations) use `REFERENCES users (id)` with no `ON DELETE` rule, so deleting a user fails while any of those rows exist.
- Migrations 015 onward choose deliberately: `ON DELETE SET NULL` for authorship that should outlive the account (posts, moderation actions, reports), `CASCADE` for personal rows (follows, sessions, tokens, join requests).

Sign-up records one agreement: `users.policy_version` and `policy_accepted_at`, for the content policy only (`POLICY_VERSION = "content-policy-draft-2026-11"`).

**Why it is probably like this.** The early migrations were the core mechanism (claim, match, prove), written before accounts had a lifecycle. By the time the discussion and moderation tables were designed, deletion was being thought about, which is why their rules are explicit. The agreement columns came with the content policy work, when it was the only document.

**3a. A bug, fixed in migration 026.** `strikes.user_id` is `ON DELETE CASCADE` (migration 024). If deletion is ever built, an account with two strikes can delete itself, sign up again, and start at zero, which defeats the repeat-infringer rule (content policy section 3). Migration 026 makes it `ON DELETE RESTRICT`: deleting an account with strikes fails. When deletion is built, it decides what to keep (for example a hash of the email, so a re-registration can be matched) before removing the user.

**Plan.**

1. Decide the rules, then write them into the privacy policy's retention table:
   - Attempts and matches: keep (CC0, others build on them); detach from the user and show "deleted account".
   - Projects owned by the user: transfer to a maintainer, or archive.
   - Posts: keep with a null author (already the rule).
   - `project_events`, imports, proposals: keep with a null actor.
   - Strikes and moderation records: keep for the retention period (see 3a).
2. Migration: switch every `REFERENCES users (id)` from 001–008 to the chosen rule. `NOT NULL` columns that become `SET NULL` drop the `NOT NULL`, and the web shows "deleted account" where the name was.
3. `DELETE /v1/me` with password confirmation; a button on the account page; an admin action for requests by email.
4. Display-name change on the account page (the privacy policy already promises corrections).
**Done (migration 028).** Steps 1–4:

- Every reference to `users` from 001–008 has a rule. SET NULL (dropping `NOT NULL`) for projects and type revisions created, attempts, matches, imports, type proposals and reviews, unresolved types, `project_events`, proposal regressions, integrations, a chunk's leaseholder, blocks made, and strikes. CASCADE for competing leases (`chunk_leases`) and ownership offers made.
- `POST /v1/auth/delete-account` (password confirmation; not open to work tokens) and `PATCH /v1/auth/me` for the display name. Both are on the web's Account page (`/account`). `npm run api:admin -- delete-user <email> [--archive-projects]` handles requests by email.
- Shared rules in `apps/api/src/services/accountDeletion.ts`. Refused for a suspended account, for an owner of projects that are not archived unless they ask to archive them, and while one of the account's submissions is being checked. Leased chunks go back to the pool at once and their competing leases are released, as blocking does. Strikes keep a SHA-256 of the email (`strikes.email_hash`); sign-up with that email takes them back.
- An archived project whose owner deleted their account has no owner and cannot be restored.
- The web, CLI, and API show "deleted account" where an author is null. Checked by `apps/api/scripts/verify-account-deletion.mjs`.

Still open:

5. Agreements: a table `agreements (user_id, document, version, accepted_at)` for content policy, terms, and privacy. Backfill the existing column into it. Sign-up asks for all three. When a document's version changes, ask signed-in users to accept it again.

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

**Today.** No `.gitattributes`. The repo is edited on Windows, files are a mix of LF and CRLF, and every commit warns.

**Why.** Nobody added one; the default `core.autocrlf` on Windows hid it.

**Done.** `.gitattributes` sets `* text=auto eol=lf` (`*.bat`/`*.cmd` CRLF, binaries marked). The index was already all LF, because `core.autocrlf=true` converted on every commit, so renormalizing changed no files. What changed is checkout: files are now written with LF whatever a machine's `autocrlf` is. Files already on disk keep CRLF until they are next checked out or rewritten. `apps/matchd/Dockerfile.ps1` is the PlayStation image, not PowerShell, so `.ps1` stays LF.

### 7b. Addresses as decimal strings

**Today.** `chunks.address` is a Postgres `bigint`; the API sends `String(row.address)`, so `4198400` instead of `0x401000`. The CLI converts it back to hex in several places.

**Why.** This one is right. Node's Postgres driver returns `int8` as a string because a JavaScript number cannot hold every 64-bit value exactly, and targets such as PS3 and Switch have 64-bit addresses. A string is the safe type.

**Plan.** Keep the string, and change its format: send hex (`"0x401000"`) everywhere, accept hex or decimal on input, and document it in the schema. This is a breaking API change for the web and the CLI, so do it before the npm release (item 5), in one change with both clients.

### 7c. Google Fonts

**Done.** The web app imports IBM Plex Sans (400, 500, 600) and Mono (400, 500) from `@fontsource` in `main.tsx`, so Vite bundles the font files and serves them from the site. `index.html` no longer links Google, the production CSP allows only `'self'` for styles and fonts, and the Google Fonts line is gone from the privacy policy. The rest of this section is the analysis it was based on.

**Today.** `index.html` loads IBM Plex Sans and Mono from Google. Audit A-037's content security policy allows `fonts.googleapis.com` and `fonts.gstatic.com` on purpose (audit change log).

**Why.** The quickest way to get the typeface; the CSP was written to allow what was already there.

**Plan.** Add `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` (only the weights used: 400, 500, 600), import them in `main.tsx`, remove the Google links, tighten the CSP to `'self'` for fonts and styles, and delete the Google Fonts paragraph from the privacy policy.

### 7d. One test runner, in CI

**Done.** `npm run verify` (`apps/api/scripts/verify-all.mjs`) does step 1: a fresh `rehydra_test_*` database, migrate and seed, the API on a free port with only the settings each script needs (never `apps/api/.env`), every script in turn, then the database is dropped. Compiling scripts are skipped without matchd. Three scripts stay manual: `verify-flags` (every compiler image) and `verify-phase3` and `verify-small-fixes` (the `scale100k` project). Two scripts were made independent of run order: `verify-report-emails` marks earlier reports notified first, and `verify-password-reset` takes the web origin from `AUDIT_APP_URL`. `npm test` runs the API, CLI, and matchd unit tests. `.github/workflows/ci.yml` does step 2 with both jobs; it has not run on GitHub yet. Step 3: `dogfood.mjs` is deleted, since `verify-checkout-loop` covers it. The rest of this section is the analysis it was based on.

**Today.** 37 API unit tests and 5 CLI tests run with `node --test`. Twenty-one `apps/api/scripts/verify-*.mjs` scripts test real behaviour (access, limits, moderation, malware, the checkout loop) but each one needs a hand-started API on port 3100 and the `rehydra_audit` database, set up as its header describes. There is no CI (no `.github/`). The roadmap's "checked by hand" notes come from this.

**Why.** The verify scripts were written during the audit to prove each fix end to end, which they do well. Each was run once by the person fixing the finding, so starting the API by hand was cheap.

**Plan.**

1. One script, `npm run verify`, that creates a fresh database, runs migrations, starts the API (and matchd where a script needs it) on a free port, runs every verify script in turn, and tears everything down.
2. A GitHub Actions workflow: typecheck, unit tests, then `npm run verify` with a Postgres service container. matchd-dependent scripts can run in a second job, since they need the compiler images.
3. Fix `fixtures/link/dogfood.mjs` (it stops at `decoy` since the call-target check) or drop it from the run.

---

## What to keep

These were good decisions and the plan does not touch them: Effect `HttpApi` shared between the API and its clients; Postgres as the one store, with the lease on the `chunks` row; matchd as a separate, token-guarded service; token, session, and reset secrets stored only as hashes; `instructions.agent` as fixed server text (A-036); content-addressed blobs; and the audit's habit of writing down each trade-off where it is made.
