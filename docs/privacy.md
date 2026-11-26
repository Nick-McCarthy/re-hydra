# Privacy policy

**Status: draft.** This is a working draft for re-hydra's first public launch, not legal advice. Have a lawyer who practises privacy law review it before publishing, especially if the site will have users in the EU, the UK, or California. Items in `[brackets]` are decisions or details still to fill in.

This policy says what re-hydra collects about you, what other people can see, who else handles it, how long it is kept, and what you can ask for.

---

## 1. Who runs re-hydra

re-hydra is run by `[operator name or legal entity]`, `[postal address]`. For anything in this policy, write to `[privacy@re-hydra.dev]`.

## 2. What we collect

**Your account**

- Your email address, display name, and password. The password is stored only as a scrypt hash; nobody at re-hydra can read it.
- When you created the account and when you last signed in.
- Which version of the content policy you agreed to at sign-up, and when.
- Whether the account is an admin account, and whether it is suspended and why.

**Signing in**

- Sessions. Signing in creates a session that lasts 30 days, or until you log out or change your password. We store a hash of the session token, when it was created and last used, and when it ended.
- Profile tokens for the hydra command-line tool. We store the label you give each one, a hash of the token, and when it was created, last used, and revoked. The token itself is shown to you once and is not stored.
- Password reset requests. We store a hash of the one-time link and when it expires.

**What you do on the site**

- Projects you create, join, or ask to join, and your role in each.
- Programs you import: the Ghidra export (function bytes, names, disassembly, decompiler output, types) and the program's hash. The whole program file is not uploaded.
- Functions you check out, the source you submit, and each attempt's result.
- Type proposals, discussion posts, follows, and reports you file.
- A log of project activity (for example "checked out", "matched", "joined"), which records who did what and when.

**Moderation**

- Reports others file about your projects, functions, or posts.
- Strikes, suspensions, and the notes admins write when they act on a report or a copyright notice.

**Technical data**

- Your IP address is used, in memory, to rate-limit requests. It is not written to the database. `[decision: whether the API host or load balancer keeps request logs with IP addresses, and for how long]`
- The website stores your session, your open checkouts, and your light or dark theme in your browser's local storage. It sets no cookies, and it uses no analytics, advertising, or tracking scripts.

## 3. What other people can see

- **Anyone:** your display name and profile, who you follow, public projects and everything in them, including the source you submit there (released under CC0, content policy 2.4) with your display name, and your posts in public projects.
- **Members of a members-only project:** the same, for that project.
- **Not shown to other users:** your email address, your tokens and sessions, the reports you file, and your strikes. Site admins see these to run the site and enforce the content policy.

A byte-by-byte comparison of a missed attempt is shown only to the person who submitted it, whoever holds that function, and the project's maintainers.

## 4. How we use it

- To run the site: sign you in, check out functions, compile and compare submissions, and show projects.
- To send email. Today the only email sent to users is a password reset you ask for. Site admins also get email about new reports and known-malware hits. `[If notification emails are added later, list them here.]`
- To enforce the content policy and these terms, prevent abuse, and keep the site secure.
- To answer legal requests and copyright notices (content policy section 3). A notice is forwarded to the project owner with the sender's contact details removed `[or: as required by law]`; a counter-notice is forwarded to the person who sent the notice.

We do not sell your information, and we do not use it for advertising.

`[Lawyer to confirm: legal bases under the GDPR: running the service you signed up for (contract), keeping it safe and enforcing the policy (legitimate interests), and legal obligations.]`

## 5. Who else handles it

- **Amazon Web Services** hosts the site, the database, stored files, and outgoing email (Amazon SES), in the United States (us-east-1). If you are outside the US, your information is transferred there. `[Lawyer to confirm the transfer mechanism, for example the EU–US Data Privacy Framework or standard contractual clauses.]`
- **abuse.ch (MalwareBazaar).** We download a list of known-malware hashes from them. Nothing about you is sent.
- **The law.** We disclose information when the law requires it, or to protect people from harm.

## 6. How long we keep it

| What | How long |
| --- | --- |
| Your account | Until you ask us to delete it |
| Sessions | They stop working after 30 days or when you log out; the records are kept `[for N days]` |
| Profile tokens | Until you revoke them; the records are kept `[for N days]` after that |
| Password reset links | They stop working when they expire or are used |
| Submitted source and attempts | Kept after your account is deleted, because it is released under CC0 and others build on it. `[decision: shown as from a deleted account, or under your display name]` |
| Posts | `[decision: deleted with the account, or kept and shown as from a deleted account]` |
| Reports, strikes, and moderation records | `[N years]`, to apply the repeat-infringer rule and keep a record of notices |
| Backups | `[N days]` |

## 7. Your choices and rights

- Change your password on the account page, revoke profile tokens on your profile page, and log out to end a session.
- Ask for a copy of your information, a correction (for example a new display name), or deletion of your account, by writing to `[privacy@re-hydra.dev]`. We answer within `[30 days]`. `[Account deletion is by request until it is built into the profile page.]`
- **EU and UK:** you also have the right to restrict or object to processing, to receive your information in a portable form, and to complain to your data protection authority.
- **California:** we do not sell or share personal information as the CCPA defines it.

## 8. Security

Passwords are stored as scrypt hashes, and session, token, and reset-link secrets only as hashes. The site is served over HTTPS. Submissions are compiled in isolated containers and never run. No system is perfect; if your information is exposed, we will tell you as the law requires.

## 9. Children

re-hydra is not for children under 13 `[or 16 in the EU and UK]`. If you believe a child has created an account, write to us and we will delete it.

## 10. Changes

We post changes here with a new date. If a change affects how your information is used, we will also tell you `[by email or with a notice on the site]` before it takes effect.

Last updated: `[date]`
