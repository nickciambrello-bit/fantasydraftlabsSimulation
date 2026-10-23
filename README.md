# Fantasy Labs

Simulation-first fantasy football. One engine powers an MCP server (Claude and
other AI assistants), a web app, and a mobile app.

## Layout

| Path | What it is |
|---|---|
| `packages/engine` | Pure TypeScript simulation engine. Seeded RNG (`createRng`) so every sim is reproducible. Today: draft sims (mock, strategy, league, pick lab). |
| `apps/web` | Next.js 14 + Supabase web app (the original Fantasy Draft Labs). |
| `supabase/legacy` | SQL schema files from the original app, in the order they were applied. |

Coming next: `packages/data` (nflverse + Sleeper ingest), `apps/api` (REST + MCP
server), `apps/mobile` (Expo).

## Develop

```bash
pnpm install
pnpm test        # engine tests
pnpm typecheck
pnpm --filter @fantasy-labs/web dev
```

## Deploying the web app on Vercel

Set the project's **Root Directory** to `apps/web`. Vercel detects pnpm
workspaces and installs from the repo root. Environment variables are the same
as before (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
