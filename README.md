# re-hydra

Crowdsourced reverse engineering: exclusive chunk checkout, local translation, byte-perfect match via **matchd**.

What is built and what is next: **[docs/roadmap.md](docs/roadmap.md)**. Working on the code (people or agents): [AGENTS.md](AGENTS.md).

## Workspace

| Package | Path | What it is |
| --- | --- | --- |
| `@re-hydra/api` | `apps/api` | Effect HTTP API: leases, attempts, proposals, and the background workers. Start here for backend work |
| `@re-hydra/matchd` | `apps/matchd` | Compile and normalized compare, plus the link step. Only the API calls it (service token) |
| `@re-hydra/cli` | `apps/cli` | Contributor CLI (`hydra`), typed against the API's `HttpApi` |
| `@re-hydra/web` | `apps/web` | Vite React client |

`compose.yaml` runs Postgres, the object bucket, and matchd; the Compose files live in `docker-yml/`. Vendored reference sources are under `repos/`.

## Docs

| Doc | What it covers |
| --- | --- |
| [docs/roadmap.md](docs/roadmap.md) | What is built, compilers, capacity, first deployment, what is open |
| [docs/architecture.md](docs/architecture.md) | How the system runs today, the product rules, and the multi-site design |
| [docs/db-schema/schema.md](docs/db-schema/schema.md) | Postgres schema of record, with a section per migration |
| [docs/db-schema/schema-reasoning.md](docs/db-schema/schema-reasoning.md) | Why the schema is shaped that way |
| [docs/foundations-plan.md](docs/foundations-plan.md) | Early decisions being revisited, and the plan for each |
| [docs/matchd-scaling.md](docs/matchd-scaling.md) | matchd measurements, capacity, and cost |
| [docs/policy/](docs/policy) | Content policy, terms of use, privacy policy (drafts; the site shows them at `/policy`, `/terms`, `/privacy`) |
| [docs/audit/](docs/audit) | The 2026-11 audit: plan, findings, change log, and phase notes |

## Quick start

Needs Node 22 and Docker Desktop.

```bash
docker compose up -d
cp apps/api/.env.example apps/api/.env   # if needed
npm install
npm run api:migrate
npm run api:seed     # dev@re-hydra.local / rehydra-dev, plus the demo, sample, and link projects
npm run api          # http://localhost:3000 (OpenAPI at /docs)
npm run web          # http://localhost:5173
```

Optional CLI: `npm run hydra -- --help`. Checks and other commands are in [AGENTS.md](AGENTS.md#local-commands).
