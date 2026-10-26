# Fantasy Labs

Simulation-first fantasy football. One engine powers an MCP server (Claude and
other AI assistants), a web app, and a mobile app.

## Layout

| Path | What it is |
|---|---|
| `packages/engine` | Pure TypeScript simulation engine. Seeded RNG (`createRng`) so every sim is reproducible. Today: draft sims (mock, strategy, league, pick lab). |
| `apps/web` | Next.js 14 + Supabase web app (the original Fantasy Draft Labs). |
| `packages/data` | Loads free NFL data into Postgres: nflverse (players, ID map, schedules with betting lines, weekly stats, snaps, injuries) and Sleeper (live status, injuries, depth charts). |
| `supabase/migrations` | Schema for the shared football data. |
| `supabase/legacy` | SQL schema files from the original app, in the order they were applied. |

Coming next: `apps/api` (REST + MCP server), `apps/mobile` (Expo).

## Develop

```bash
pnpm install
pnpm test        # engine tests
pnpm typecheck
pnpm --filter @fantasy-labs/web dev
```

## Loading NFL data

1. Run `supabase/migrations/20261026000000_football_data.sql` in the Supabase SQL editor.
2. Add a `DATABASE_URL` repository secret in GitHub (Supabase > Connect > Transaction pooler URI).
3. Backfill once: Actions > Data ingest > Run workflow, seasons `2018-2026`.
   After that it runs daily for the current season.

Locally: `DATABASE_URL=... pnpm --filter @fantasy-labs/data ingest all --seasons 2018-2026`.

## Deploying the web app on Vercel

Set the project's **Root Directory** to `apps/web`. Vercel detects pnpm
workspaces and installs from the repo root. Environment variables are the same
as before (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
