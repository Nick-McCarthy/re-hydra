# @re-hydra/cli

Thin Effect CLI for the contributor loop: login, checkout a work bundle, submit, heartbeat, release.

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
npm run hydra -- login dev@re-hydra.local
npm run hydra -- me
npm run hydra -- list demo
npm run hydra -- checkout demo <chunk-id>
cd chunks/demo/<name>
# edit candidate.c
npm run hydra -- submit   # waits until matchd finishes and prints diagnostics
npm run hydra -- heartbeat
npm run hydra -- release
```

Or via workspace bin after link:

```bash
npx hydra --help
```

### Auth

- `hydra login <email>` — requests a magic link; with `AUTH_EXPOSE_DEV_TOKEN=true` consumes automatically
- `hydra login --consume <magic-token>` — exchange a console/email token
- `hydra login --token <session>` — store an existing session (e.g. from seed output)
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
  attempt.c          # if a prior best attempt exists
  candidate.c        # the agent writes this; then hydra submit
  .lease.json        # lease token + metadata
```

`submit` / `release` / `heartbeat` discover `.lease.json` by walking up from the cwd.
