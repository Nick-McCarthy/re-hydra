# @re-hydra/cli

Thin Effect CLI for the contributor loop: login, list a page of chunks, checkout a work bundle, submit, watch a lease, release.

Part of **Milestone 1** (done). See `docs/roadmap.md`.

## Setup

```bash
# from repo root (API must be running)
npm install
npm run api:migrate && npm run api:seed
npm run api
```

## Usage

```bash
# from repo root
npm run hydra -- login --email dev@re-hydra.local --password rehydra-dev
npm run hydra -- me
npm run hydra -- list demo --state open --query parse --limit 100 --page 1
npm run hydra -- checkout demo <chunk-id>
cd chunks/demo/<name>
# edit candidate.c
npm run hydra -- submit   # waits until matchd finishes and prints diagnostics
npm run hydra -- watch    # heartbeat until Ctrl+C
npm run hydra -- attempts
npm run hydra -- release
```

Or via workspace bin after link:

```bash
npx hydra --help
```

### Auth

- `hydra login` — prompts for email and password and saves a session
- `hydra login --email <email> --password <password>` — sign in without prompts
- `hydra login --token <token>` — save a profile token created on your profile page
- `hydra logout` — a session is revoked. A profile token is forgotten on this machine and stays valid until you revoke it
- `hydra list <slug> --state <open|leased|validating|matched|stale|blocked> --query <name or address> --limit <n> --page <n>` — one page. `--limit` defaults to 100. `--page` starts at 1
- `hydra attempts [slug] [chunk-id]` — attempt history. Inside a checkout, the slug and chunk come from `.lease.json`
- `hydra watch --interval <seconds>` — heartbeat the checkout in the current directory until Ctrl+C. Default interval is 300 seconds, and the first beat is immediate
- `--json` — print the API JSON instead of sentences
- Config: `%APPDATA%/re-hydra/config.json` (Windows) or `~/.config/re-hydra/config.json`
- Override API URL: `hydra --url http://localhost:3000 …`

### Work bundle

Checkout writes:

```text
chunks/<project>/<chunk>/
  chunk.json
  original.bin
  pseudocode.c
  disassembly.s
  types.h
  neighbors.json
  instructions.agent # point an agent at this file
  integration.txt    # if the last match failed the link
  attempt.c          # if a prior best attempt exists
  candidate.c        # the agent writes this; then hydra submit
  .lease.json        # lease token + metadata
```

`submit` / `release` / `heartbeat` discover `.lease.json` by walking up from the cwd.
