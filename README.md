# re-hydra

Crowdsourced reverse engineering: exclusive chunk checkout, local translation, byte-perfect match via **matchd**.

## Status

**Milestone 1 is done.** Milestone 2 API is done (web UI pending). See **[docs/status.md](docs/status.md)** for the handoff checklist, runbook, and next steps.

Product rules: [docs/planning.md](docs/planning.md) · Schema: [docs/db-schema/schema.md](docs/db-schema/schema.md) · Agent notes: [AGENTS.md](AGENTS.md)

## Workspace

| Package | Path |
| --- | --- |
| `@re-hydra/api` | `apps/api` |
| `@re-hydra/matchd` | `apps/matchd` |
| `@re-hydra/cli` | `apps/cli` (`hydra`) |
| `@re-hydra/web` | `apps/web` |

## Quick start

```bash
docker compose up -d
cp apps/api/.env.example apps/api/.env   # if needed
npm install
npm run api:migrate
npm run api:seed
npm run api          # http://localhost:3000
npm run web          # http://localhost:5173
```

Optional CLI: `npm run hydra -- --help`
