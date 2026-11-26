# @re-hydra/web

React client for re-hydra: projects and the chunk board, checkout and submit, attempts and diagnostics, types, discussion, profiles, the Account page, and the admin pages. What each feature does is in [docs/roadmap.md](../../docs/roadmap.md).

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4 + shadcn-style UI primitives
- React Router
- Dev proxy: `/v1` → `http://127.0.0.1:3000`

## Local

`npm run web` from the repo root, with the API running (setup: the root [README.md](../../README.md)). App: http://localhost:5173

## Scripts

| Script | Description |
| --- | --- |
| `npm run web` | Vite dev server |
| `npm run web:typecheck` | `tsc -b` |
| `npm run web:build` | production build |

## Notes

- Session and lease tokens live in `localStorage`
- `/policy`, `/terms`, and `/privacy` render `docs/policy/*.md` at build time, so those files are the site's text
- Path alias `@/*` → `src/*` (TypeScript 7: no `baseUrl`)
- Prefer `import.meta.dirname` / `fileURLToPath` in Vite config (not bare `__dirname`)
