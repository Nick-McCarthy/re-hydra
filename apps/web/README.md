# @re-hydra/web

React client for re-hydra (Milestone 1 complete).

## Features

- Email and password sign-up, sign-in, and password change
- Profile tokens for the `hydra` CLI, created and revoked on your own profile
- Project list + chunk board with live stats
- Chunk checkout / heartbeat / release / submit
- Download a checkout as a zip (`instructions.agent`, `candidate.c`, `types.h`, disassembly, original bytes, and `integration.txt` when the last match failed the link)
- Match diagnostics: compile errors, or a side-by-side instruction diff
- Auto-heartbeat every 5 minutes while the chunk page is open
- Attempt history on the chunk page
- Maintainer **Clear lease** (when membership is owner/maintainer)
- Public user profiles (`/users/:userId`) with matched chunks

Milestone 2 (type proposals, unresolved types, fuse) has a UI. See `docs/roadmap.md`.

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4 + shadcn-style UI primitives
- React Router
- Dev proxy: `/v1` → `http://127.0.0.1:3000`

## Local

```bash
# from repo root (API + Postgres + matchd should be running)
npm install
npm run web
```

- App: http://localhost:5173

## Scripts

| Script | Description |
| --- | --- |
| `npm run web` | Vite dev server |
| `npm run web:typecheck` | `tsc -b` |
| `npm run web:build` | production build |

## Notes

- Session + lease tokens live in `localStorage`
- Path alias `@/*` → `src/*` (TypeScript 7: no `baseUrl`)
- Prefer `import.meta.dirname` / `fileURLToPath` in Vite config (not bare `__dirname`)
