# @re-hydra/api

Effect 4 HTTP API: exclusive chunk checkout, matchd-backed normalized matching, type proposals, the integration build, the directory, discussion, and moderation. How it fits together is [docs/architecture.md](../../docs/architecture.md); the tables are [docs/db-schema/schema.md](../../docs/db-schema/schema.md).

## Stack

- Effect 4 (`effect`, `effect/http-api`, `effect/sql`) on `@effect/platform-node`
- `@effect/sql-pg` + Postgres 16
- Declarative `HttpApi` in `src/Api.ts`, shared with the CLI. OpenAPI (Scalar) at `/docs` is the endpoint reference
- Email and password auth → bearer sessions; profile tokens (`work` or `all` scope) for the CLI and agents

## Running

Setup is the quick start in the root [README.md](../../README.md). Then:

- API: http://localhost:3000/v1/health
- Endpoint reference: http://localhost:3000/docs

`npm run api:seed` sets the local password for `dev@re-hydra.local` to `rehydra-dev` and prints a session token.

## Auth

```bash
curl -s -X POST http://localhost:3000/v1/auth/sign-in \
  -H 'content-type: application/json' \
  -d '{"email":"dev@re-hydra.local","password":"rehydra-dev"}'

curl -s -X POST http://localhost:3000/v1/auth/sign-up \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","displayName":"Ada","password":"a-long-password","acceptPolicy":true}'
```

## Import (owner / maintainer)

`rightsConfirmed=true` affirms the three statements of content policy 2.3; the import form and `hydra import --confirm-rights` ask for them.

```bash
curl -s -X POST "http://localhost:3000/v1/projects/demo/imports?rightsConfirmed=true" \
  -H "authorization: Bearer <session>" \
  -H 'content-type: application/json' \
  -d @export.json
```

Export JSON shape (camelCase):

```json
{
  "binarySha256": "<64 hex>",
  "arch": "x86_64",
  "name": "demo.bin",
  "types": "/* headers */",
  "functions": [
    {
      "name": "parse_header",
      "address": "0x401000",
      "size": 6,
      "bytesBase64": "...",
      "pseudocode": "void parse_header(void) {}",
      "disassembly": "parse_header:\n  ret\n",
      "callees": ["0x401200"],
      "typesUsed": ["Header"]
    }
  ]
}
```

Re-importing updates open, stale, and blocked chunks in place and leaves leased, validating, and matched rows alone.

## Seed fixtures

| Slug | What it is |
| --- | --- |
| `demo` | One chunk, `parse_header`, a single `ret`. An empty function under `-O2` can match |
| `sample` | `skip_space`, `header_size`, and `parse_header`: real `gcc -O2` output of `fixtures/sample/funcs.c`, compiled together. An isolated resubmit of `parse_header` will not match; the leaves can. Rebuild with `node fixtures/sample/build.mjs` (needs the `re-hydra-matchd` image) |
| `link` | `leaf` and `caller` linked at `0x401000` and `0x401040`. `decoy` can match in isolation and then fail the integration build |

## Background workers

All run inside the API process (`src/main.ts`):

- **Match worker** (`MatchWorker.ts`) — `MATCHD_WORKERS` claimers take interactive and type-recheck jobs, and one takes recipe rechecks; each calls matchd and applies the result once
- **Integration worker** (`IntegrationWorker.ts`) — runs integration builds through matchd's link step
- **Lease sweeper** (`LeaseSweeper.ts`) — every 30 s: expires leases, promotes competing leases, recounts recently changed projects
- **matchd scaler** (`MatchdScaler.ts`) — with `MATCHD_SCALE=docker`, starts and stops extra local copies of a busy image
- **Report notifier** (`ReportNotifier.ts`) — emails site admins about new reports
- **Malware list** (`MalwareHashes.ts`) — refreshes the known-malware hash list, rechecks programs, and emails admins about hits

Queue and routing settings (`MATCHD_URL`, `MATCHD_ROUTES`, `MATCHD_SCALE`) are described in [architecture.md](../../docs/architecture.md#match-queue).
