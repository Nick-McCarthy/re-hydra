# @re-hydra/cli

Thin Effect CLI for the contributor loop: take the next open chunk or a named one, see what you hold, submit and see where the bytes differ, keep the lease alive, release. People and agents use it the same way.

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
npm run hydra -- next demo              # take the first open chunk (--smallest, --query)
npm run hydra -- checkout demo parse_header   # or by id, or by address: 0x401000
npm run hydra -- status                 # what you hold, where, and when it expires
cd chunks/demo/<name>
# edit candidate.c
npm run hydra -- submit   # waits for the result; on a miss, shows where the bytes differ
npm run hydra -- show     # state, holder, and best attempt
npm run hydra -- refresh  # new types.h / neighbors.json; keeps candidate.c
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
### Work

- `hydra list <slug> --state <open|leased|validating|matched|stale|blocked> --query <name or address> --limit <n> --page <n>` — one page. `--limit` defaults to 100. `--page` starts at 1
- `hydra next <slug> [--query <text>] [--smallest] [--out <dir>]` — check out the first open chunk (or the smallest of the first 500). If someone takes it first, the next one is tried, up to five
- `hydra checkout <slug> <chunk>` — the chunk is its id, its exact name, or its address (`0x401000`; bare digits are tried as hex, then decimal)
- `hydra status` — your leases with their folder and time left, attempts still being checked, and the last five results. Folders come from `leases.json` in the config directory, so a lease taken on another machine shows no folder
- `hydra show [slug] [chunk]` — one chunk's state, lease, attempt count, and best attempt. Inside a checkout, no arguments
- `hydra refresh` — download the work bundle again inside a checkout (types, neighbors, best attempt); `candidate.c` is kept
- `hydra submit [file] [--wait <seconds>]` — submit `candidate.c` (or the file) and wait up to 60 seconds for the result. A miss prints the first differing byte and the bytes around it; `--json` adds `byteDiff`
- `hydra attempts [slug] [chunk]` — attempt history. Inside a checkout, the slug and chunk come from `.lease.json`
- `hydra watch --interval <seconds>` — heartbeat the checkout in the current directory until Ctrl+C. Default interval is 300 seconds, and the first beat is immediate
- `--json` — print the API JSON instead of sentences
- Config: `%APPDATA%/re-hydra/config.json` (Windows) or `~/.config/re-hydra/config.json`
- API URL: `hydra --url http://localhost:3000 …` saves it for later commands; without `--url`, the saved one is used

### Exit codes

For scripts and agents:

| Code | Meaning |
| --- | --- |
| 0 | Done; for `submit`, the attempt matched |
| 1 | Any other failure (the message says why) |
| 2 | `submit`: the attempt finished and did not match (a miss or a compile error) |
| 3 | `submit`: still being checked when `--wait` ran out |
| 4 | Not signed in, or the session or token was refused |
| 5 | No `.lease.json` here, or the server no longer has the lease (expired, released) |
| 6 | `next`: no open chunk to take |

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
