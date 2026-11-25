# Fantasy Labs MCP server

Gives Claude live NFL data and your league's full history as tools. Runs on
your computer over stdio; nothing is hosted. Personal use only (ESPN's and
Sleeper's public endpoints are unofficial and non-commercial).

## Tools

| Tool | Source | What you get |
|---|---|---|
| `game_lines` | The Odds API (free key) or nflverse fallback | Spread, total and **implied team totals** for this week, median across US books, plus your remaining API quota |
| `game_weather` | Open-Meteo (no key) | Kickoff-window temp, wind, gusts, rain/snow per stadium; domes skipped, retractable roofs flagged, fantasy impact note |
| `espn_injuries` | ESPN public API | Live designations + latest blurb, hides updates older than 10 days |
| `espn_news` | ESPN public API | Headlines from the last 3 days only (configurable), by team or player |
| `depth_chart` | ESPN, falls back to nflverse's daily ESPN snapshot | QB/RB/WR/TE/K depth, WR1/WR2/WR3 spots split out |
| `snap_counts` | nflverse | Snap % by week, recent vs season average, trend |
| `next_gen_stats` | nflverse (NGS) | Separation, cushion, air-yard share, YAC over expected, CPOE, time to throw, rush yards over expected |
| `coverage_profile` | nflverse/FTN participation | Defense: man vs zone, Cover 0-9 shells, pressure rate, box counts. Offense: 11/12/21 personnel, formations, targeted routes |
| `injury_report` | nflverse | The official Wed-Fri report with practice participation |
| `league_history_sync` | Sleeper | Pulls every season (follows `previous_league_id`) into SQLite |
| `league_history_status` | local DB | What's stored and when it was synced |
| `manager_tendencies` | local DB | Record, titles, FAAB habits (overbid vs next-best bid, big swings, early spending), panic drops, churn, trade partners, draft habits |
| `faab_history`, `trade_history`, `draft_history`, `head_to_head` | local DB | The details behind the tendencies |
| `league_history_sql` | local DB | One read-only `SELECT` for anything else |

Every response includes `respondedAt` and `fetchedAt`. Nothing from Sleeper,
ESPN, Odds or Open-Meteo is cached. Large nflverse files are kept in memory
for 30 minutes to 6 hours (pass `refresh: true` to re-download), and their
responses say the newest week in the file.

## Set up for Claude Desktop

1. **Node 22.13 or newer** (`node -v`). The history store uses Node's built-in SQLite.
2. Build:
   ```bash
   git clone https://github.com/nickciambrello-bit/fantasydraftlabsSimulation.git
   cd fantasydraftlabsSimulation
   pnpm install
   pnpm --filter @fantasy-labs/mcp build
   ```
3. Optional but recommended: get a free key at https://the-odds-api.com (500 credits a month; each `game_lines` call uses 2).
4. Open Claude Desktop > Settings > Developer > Edit Config, and add:
   ```json
   {
     "mcpServers": {
       "fantasy-labs": {
         "command": "node",
         "args": [
           "--disable-warning=ExperimentalWarning",
           "/FULL/PATH/TO/fantasydraftlabsSimulation/apps/mcp/dist/index.js"
         ],
         "env": {
           "ODDS_API_KEY": "your-key-here",
           "SLEEPER_LEAGUE_ID": "1366915864577708032"
         }
       }
     }
   }
   ```
   If Claude Desktop can't find the right Node, replace `"node"` with the output of `which node` (macOS) or `where node` (Windows).
5. Restart Claude Desktop. Then ask: *"Sync my league history, then tell me who overbids on FAAB."*

Check every source from your machine with:

```bash
pnpm --filter @fantasy-labs/mcp smoke
```

## Settings (env vars)

| Variable | Default | |
|---|---|---|
| `ODDS_API_KEY` | none | Without it `game_lines` uses nflverse's lines (refreshed about daily) |
| `SLEEPER_LEAGUE_ID` | `1366915864577708032` (JandO League 2026) | Newest season's id; older seasons are found automatically |
| `FANTASY_LABS_DB` | `~/.fantasy-labs/league-history.sqlite` | Where league history lives |

## League history notes

- Re-run `league_history_sync` whenever you want new weeks. Finished seasons
  are skipped (`force: true` re-pulls them); the current season is replaced
  each time, so nothing duplicates.
- "Overbid" compares a winning bid with the best losing bid on the same player
  that week, using Sleeper's failed waiver claims.
- "Panic drop" = dropping a player you drafted in rounds 1-8. "Churn" = dropping
  someone within 2 weeks of adding him.
- Sleeper's full player list is downloaded at most once a day, per Sleeper's guidance.

## Develop

```bash
pnpm --filter @fantasy-labs/mcp test
pnpm --filter @fantasy-labs/mcp typecheck
```
