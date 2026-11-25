# Content policy: copyrighted software and malware

**Status: draft.** This is a working draft for re-hydra's first public launch, not legal advice. Have a lawyer who practises copyright and internet law in your jurisdiction review it before publishing. Items in `[brackets]` are decisions or details still to fill in. Section 6 (not shown on the site's policy page) lists what the product has to do to back this policy up.

---

## 1. What re-hydra is, and what it holds

re-hydra is a place to rebuild C and C++ source code for existing programs, one function at a time. A project owner imports an export from Ghidra. Each function becomes a chunk that a contributor checks out, writes source for, and submits. A compile server builds that source with the project's compiler and compares the result with the original bytes.

So the site holds:

| What | Who can see it |
| --- | --- |
| Each function's machine-code bytes, disassembly, and Ghidra's pseudocode | The contributor holding the chunk, in their work bundle. A missed attempt's diagnostics compare the original bytes with the candidate's; that comparison is shown only to the submitter, the chunk's current holder, and project maintainers. Everyone else sees the score without the bytes. Integration diagnostics likewise show bytes only to maintainers |
| Names of functions, symbols, types, and the binary; each function's address and size | Anyone |
| Source code that contributors submit | The submitter, and later contributors on that chunk (the best attempt so far) |
| Discussion posts | Anyone |

The compile server only compiles and links contributors' source. **re-hydra never runs an uploaded binary or any program built from submitted source.**

## 2. Copyrighted software

Most programs people will want to rebuild here are copyrighted by someone else. Studying how a program works and writing new source that compiles to the same bytes is a long-standing practice, but the rules differ by country, and some uses are not allowed anywhere. These rules keep re-hydra on the side of research, preservation, and interoperability, and away from distributing other people's software.

### 2.1 You may

- Start a project for a program you legitimately own a copy of.
- Import what matching needs: function bytes, disassembly, pseudocode, symbol names, and the types you recovered.
- Write and submit your own source code for those functions.
- Discuss how the program works.

### 2.2 You may not

- **Distribute the program.** No ROMs, disc images, executables, installers, or download links to them, in any field, file, or post. Imports never include the whole program: re-hydra keeps only its hash, and an export that carries the full file is refused. Function bytes are enough for matching.
- **Upload leaked material.** No leaked source code, leaked SDKs, internal documents, or anything that came from a breach. Do not use leaked source to write submissions, even if you rewrite it. If a project's history depends on a leak, it will be removed.
- **Upload licensed developer tools.** Retail SDK compilers, libraries, and headers stay off re-hydra. The registered compilers are public builds for this reason.
- **Upload keys or circumvention tools.** No encryption or signing keys, no tools or instructions for getting around copy protection or DRM.
- **Upload game assets.** No art, audio, video, text dumps, or level data. Matching works on code only.
- **Help with cheating or piracy.** No projects or posts aimed at cheating in online games, defeating anti-cheat, or enabling piracy.

### 2.3 When you import

The import screen asks you to confirm that:

1. You legitimately own a copy of the program.
2. The export contains only what this policy allows.
3. You understand that function bytes and disassembly will be shown to contributors, and names to everyone.

The import is refused until all three are ticked. re-hydra records who confirmed and when.

### 2.4 Source code you submit

Your submissions are stored and shown to later contributors on that chunk, so they can build on the best attempt. By submitting, you release your source under the Creative Commons CC0 1.0 Universal public domain dedication: anyone may use, change, and share it, with no conditions and no credit required. This lets later contributors build on an attempt without tracking who wrote which line. You confirm it is your own work and was not copied from leaked or proprietary source, or from code under another license.

If you let an agent or a script submit under your account, what it submits counts as yours: this section, and the rest of this policy, apply to it as if you had written it.

### 2.5 What counts as infringement here

`[Lawyer to review this section. It explains how re-hydra applies copyright to what people do on the site; it is not a statement of the law.]`

Copyright law differs by country, and rebuilding source that matches a program's bytes has seen little testing in court. This is how re-hydra treats the things people upload and do.

**Infringing.** We remove these when we find them, with or without a complaint:

- Copies of the program, in whole or in large part: ROMs, disc images, executables, or links to them. No reverse-engineering defence covers handing out the work itself.
- Leaked or proprietary source code, pasted into a submission or a post, or used as the basis of a submission even after rewriting.
- Game assets: art, audio, video, script and text dumps, level data.
- Files from licensed developer kits: retail compilers, libraries, and headers.

**Handled the same way.** Encryption or signing keys, and tools or instructions for getting around copy protection. In the US these fall under anti-circumvention law (17 U.S.C. § 1201), which applies even when nothing is copied.

**What re-hydra itself relies on.** Matching needs some copying: an import stores each function's bytes, disassembly, and Ghidra's pseudocode, and shows them to the contributor working on that function. US courts have found that copying a program to study how it works can be fair use when it is needed to understand it, for example to make compatible software (Sega v. Accolade, 1992; Sony v. Connectix, 2000). Those cases involved private study, not a shared site, which is why re-hydra keeps that copying small: function bytes only, never the whole program; byte comparisons shown only to the people working on a function; and an importer who confirms they own a copy. A rights holder may still object to a project, and source that compiles to the same bytes may be argued to derive from the original. Those disputes go through section 3, and we act on complete notices.

**Generally fine.** Function, symbol, and type names; addresses and sizes; and discussion of how a program works.

**Strikes.** For the repeat-infringer rule in section 3, a strike is one of:

1. A complete notice under section 3 that we act on, which is not reversed by a counter-notice or on review.
2. Our own finding that an account posted something in the infringing list above, such as a link to a ROM or pasted leaked source.

Matching work of the kind described under "What re-hydra itself relies on" does not count as a strike unless a rights holder sends a notice and it stands.

## 3. Copyright complaints (notice and takedown)

If you hold rights in software and believe something on re-hydra infringes them, send a notice to our designated agent:

> `[Name or role]`
> `[Postal address]`
> `[Email, e.g. copyright@re-hydra.dev]`

For a notice under the US Digital Millennium Copyright Act (17 U.S.C. § 512(c)(3)), include:

1. Your physical or electronic signature.
2. The copyrighted work you believe is infringed.
3. The material on re-hydra, with enough detail to find it (project URLs, chunk names).
4. Your contact details.
5. A statement that you believe in good faith the use is not authorised by the owner, its agent, or the law.
6. A statement, under penalty of perjury, that the notice is accurate and that you are the owner or authorised to act for them.

**What happens next**

- We act on a complete notice within `[2 business days]`. We usually archive the whole project: it disappears from listings and its pages stop loading, and checkouts end. We may instead remove specific material.
- We tell the project owner, and forward the notice with your personal contact details removed `[or: as required by law]`.
- **Counter-notice.** If the owner believes the removal was a mistake or the use is lawful, they can send a counter-notice with the elements in 17 U.S.C. § 512(g)(3). We forward it to you. Unless you tell us within 10 to 14 business days that you have filed a court action, we may restore the material.
- **Repeat infringers.** We close the accounts of people who repeatedly upload infringing material. Section 2.5 says what counts as a strike. An account with three strikes in 12 months is closed. A strike reversed by a counter-notice, or found to be a mistake, does not count.

Rights holders outside the US can use the same address. We handle notices under other laws (for example the EU Digital Services Act) through the same process, adapted as those laws require. `[Lawyer to confirm.]`

## 4. Malware

re-hydra stores uploaded function bytes and serves them to contributors. It does not run them. Even so, a public site full of malicious code is a risk to contributors and a target for abuse. For launch, the rule is simple:

### 4.1 Not allowed

- Projects whose program is malware: viruses, worms, ransomware, trojans, spyware, stalkerware, botnet clients, credential stealers, and their loaders or droppers. This includes historical samples.
- Projects or posts meant to build, improve, repair, or deploy malicious software, including rebuilding a malware family's source so it can be modified.
- Exploit code meant to attack systems you do not own. Security research that does not involve sharing working attack code is fine in discussion.

`[decision: whether to allow malware-analysis projects later, for example closed projects with vetted members. They are out of scope for launch.]`

### 4.2 If you find malware

Use the Report button on the project, the function, or the post, and choose Malware. You can also write to `[security@re-hydra.dev]`. Do not try to run it to check. We archive suspected malware projects first and review them afterwards.

### 4.3 What re-hydra does

- The compile server runs in a sandbox: no network, a read-only toolchain, a private temporary directory, a 30-second limit, a 1 GB data cap, and a list of allowed compiler flags. It compiles and links; it never runs the output.
- Work bundles are downloads of bytes and text, not programs. Contributors should still open them only in their own analysis tools.
- Each import's program hash (SHA-256) is checked against a public list of known malware ([MalwareBazaar](https://bazaar.abuse.ch/)), refreshed daily. A listed program cannot be imported, and the site admins are told. A program already on the site that turns up on a later list is flagged for the admins, who decide whether to archive its project. An admin can clear a false positive after a look.
- The check sees only the hash the export reports, so it catches mistakes, not someone set on hiding what they upload. Reports (4.2) cover the rest.

## 5. Enforcement

When something breaks this policy we may, depending on how serious it is:

- remove the material, a post, or a chunk;
- archive the project;
- block a user from a project (owners can do this too);
- suspend or close an account.

We try to tell the affected people what was removed and why, unless the law or safety says otherwise. To appeal, write to `[appeals address]` within 30 days.

## 6. What the product needs before this policy is published

The policy promises things the product does not do yet:

| Needed | Why | State |
| --- | --- | --- |
| Terms of use, and agreeing to them at sign-up | Makes the policy binding on users | Sign-up requires agreeing to this policy and stores the version (`content-policy-draft-2026-11`) and time. Separate terms of use are not written |
| A rights confirmation on import (section 2.3) | The importer takes responsibility for what they upload | Done: three checkboxes on the import form; the API refuses an import without `rightsConfirmed=true` and records who confirmed |
| A decision on full-binary upload (`binaryBase64`) | Matching does not need it. Dropping it removes the riskiest thing stored | Done: dropped. The API refuses an export that carries it; only the program's hash is kept |
| A license for submitted source (section 2.4), shown on the submit screen | Later contributors see and reuse submissions | Done: CC0 1.0. Shown under the Submit button, printed by `hydra submit`, stated in the agent instructions, and recorded on each attempt (`source_license`) |
| A repeat-infringer rule (section 3) | Safe-harbour protection in the US needs one that is actually enforced | Done: three active strikes in 12 months. Admins add and reverse strikes on the Users tab, which shows each account's count and flags the limit; suspension stays a manual step |
| A report button on projects, chunks, and posts | The malware and abuse path in sections 4.2 and 5 | Done: signed-in users, 10 reports an hour |
| Admin tools: archive a project, remove material, suspend an account, keep a record of notices | Acting on a takedown within the stated time | Done: `/admin` (reports queue, archive and restore projects, remove posts, suspend and restore accounts, the record). Every action needs a note. Admins are granted with `npm run api:admin -- grant <email>`. Notices that arrive by email are logged by putting their details in the action's note. Admins are emailed about new reports within a minute |
| A registered DMCA designated agent | Safe-harbour protection in the US needs a registered agent with the Copyright Office | Not done |
| Contact addresses: copyright, security, appeals | Named in sections 3, 4, and 5 | Not set up |
| Known-malware hash check on import | Section 4.3 | Done: MalwareBazaar SHA-256 list, refreshed daily. Listed imports are refused; programs already on the site are re-checked after each refresh; admins are emailed and review hits on `/admin`. Needs a free abuse.ch Auth-Key in production |
| Limit who reads byte comparisons in diagnostics | A missed attempt's diagnostics print the original bytes (masked) next to the candidate's, and the attempts list needs no sign-in | Done: the byte lines are removed except for the submitter, the chunk's holder, and maintainers (integrations: maintainers only) |
| A public page for this policy, linked from the footer, sign-up, and import | Users must be able to find it | Done: `/policy` shows sections 1–5 of this file |
