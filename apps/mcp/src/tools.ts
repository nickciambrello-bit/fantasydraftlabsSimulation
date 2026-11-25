import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getOdds } from "./sources/odds.js";
import { gameWeather } from "./sources/weather.js";
import { espnDepthChart, espnInjuries, espnNews } from "./sources/espn.js";
import { injuryReports, nextGenStats, participationProfile, snapCounts } from "./sources/nflverse.js";
import { openDb, defaultDbPath, type Db } from "./history/db.js";
import { syncLeagueHistory } from "./history/sync.js";
import {
  SCHEMA_DOC, draftHistory, faabHistory, headToHead, listManagers, managerTendencies, runReadOnlySql, syncStatus, tradeHistory,
} from "./history/queries.js";

export const DEFAULT_LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID ?? "1366915864577708032"; // JandO League 2026

let db: Db | null = null;
const getDb = () => (db ??= openDb(defaultDbPath()));

type Json = Record<string, unknown>;
const ok = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(stamp(data), null, 1) }],
});
const fail = (e: unknown) => ({
  isError: true,
  content: [{ type: "text" as const, text: `Error: ${(e as Error)?.message ?? String(e)}` }],
});
/** Every response carries the time it was produced, so stale data is obvious. */
function stamp(data: unknown) {
  const now = new Date().toISOString();
  return data && typeof data === "object" && !Array.isArray(data) ? { respondedAt: now, ...(data as Json) } : { respondedAt: now, data };
}
const run =
  <A>(fn: (a: A) => unknown | Promise<unknown>) =>
  async (a: A) => {
    try {
      return ok(await fn(a));
    } catch (e) {
      return fail(e);
    }
  };

const team = z.string().describe('Team abbreviation or name, e.g. "KC", "LAR", "Packers"');
const season = z.number().int().optional().describe("NFL season year. Defaults to the current season.");
const refresh = z.boolean().optional().describe("Force a fresh download instead of the short in-memory cache.");
const manager = z.string().describe("Manager display name, team name or Sleeper user id (partial names work).");

export function registerTools(server: McpServer) {
  // ---------------- live game context ----------------
  server.registerTool(
    "game_lines",
    {
      title: "Vegas spreads and totals",
      description:
        "This week's NFL point spreads, game totals and implied team totals (consensus across US sportsbooks via The Odds API). Implied team total is the best quick signal for which offenses will score.",
      inputSchema: { team: team.optional(), refresh },
    },
    run((a) => getOdds({ team: a.team }, { refresh: a.refresh })),
  );

  server.registerTool(
    "game_weather",
    {
      title: "Game-day weather",
      description:
        "Kickoff-window forecast (temp, wind, gusts, rain/snow) for each NFL game this week from Open-Meteo, with dome/retractable roofs flagged and a fantasy impact note.",
      inputSchema: { team: team.optional(), season, week: z.number().int().optional(), refresh },
    },
    run((a) => gameWeather({ team: a.team, season: a.season, week: a.week }, { refresh: a.refresh })),
  );

  server.registerTool(
    "espn_injuries",
    {
      title: "ESPN injury report (live)",
      description:
        "Current injury designations from ESPN with the latest update blurb and how many days old it is. By default only fantasy positions and updates from the last 10 days.",
      inputSchema: {
        team: team.optional(),
        player: z.string().optional(),
        max_age_days: z.number().optional().describe("Hide updates older than this (default 10)."),
        all_positions: z.boolean().optional(),
      },
    },
    run((a) => espnInjuries({ team: a.team, player: a.player, maxAgeDays: a.max_age_days, allPositions: a.all_positions })),
  );

  server.registerTool(
    "espn_news",
    {
      title: "ESPN NFL news (date-filtered)",
      description: "Recent ESPN NFL news headlines, filtered to the last few days (default 3). Filter by team or player.",
      inputSchema: { team: team.optional(), player: z.string().optional(), max_age_days: z.number().optional() },
    },
    run((a) => espnNews({ team: a.team, player: a.player, maxAgeDays: a.max_age_days })),
  );

  server.registerTool(
    "depth_chart",
    {
      title: "Team depth chart",
      description: "Offensive skill-position depth chart from ESPN (falls back to nflverse's daily ESPN snapshot).",
      inputSchema: { team, refresh },
    },
    run((a) => espnDepthChart({ team: a.team }, { refresh: a.refresh })),
  );

  // ---------------- nflverse usage and tracking data ----------------
  server.registerTool(
    "snap_counts",
    {
      title: "Snap share trends",
      description:
        "Offensive snap share by player from nflverse: recent-weeks average vs season average, plus each week's %. Great for spotting role changes.",
      inputSchema: {
        season,
        team: team.optional(),
        player: z.string().optional(),
        position: z.string().optional().describe("QB, RB, WR, TE"),
        weeks: z.number().int().optional().describe("How many recent weeks count as 'recent' (default 4)."),
        min_pct: z.number().optional(),
        refresh,
      },
    },
    run((a) => snapCounts({ ...a, minPct: a.min_pct }, { refresh: a.refresh })),
  );

  server.registerTool(
    "next_gen_stats",
    {
      title: "NFL Next Gen Stats",
      description:
        "NGS tracking stats from nflverse. receiving: separation, cushion, air-yard share, YAC over expected. passing: time to throw, aggressiveness, CPOE. rushing: rush yards over expected, 8-man boxes. week omitted = season to date.",
      inputSchema: {
        kind: z.enum(["receiving", "passing", "rushing"]),
        season,
        week: z.number().int().optional(),
        team: team.optional(),
        player: z.string().optional(),
        limit: z.number().int().optional(),
        refresh,
      },
    },
    run((a) => nextGenStats(a, { refresh: a.refresh })),
  );

  server.registerTool(
    "coverage_profile",
    {
      title: "Coverage and personnel tendencies",
      description:
        "From nflverse/FTN participation data. side=defense: man vs zone share, coverage shells (Cover 1/2/3/4...), pressure rate, box counts. side=offense: personnel groupings, formations, targeted routes, pressure allowed. Note: nflverse publishes a season's file after it ends, so the current season may not be there yet.",
      inputSchema: {
        team,
        side: z.enum(["offense", "defense"]),
        season,
        weeks: z.array(z.number().int()).optional(),
        refresh,
      },
    },
    run((a) => participationProfile(a, { refresh: a.refresh })),
  );

  server.registerTool(
    "injury_report",
    {
      title: "Official NFL injury report",
      description:
        "The league's official weekly injury report (game status + Wed-Fri practice participation) from nflverse. Defaults to the latest week in the file.",
      inputSchema: {
        season,
        week: z.number().int().optional(),
        team: team.optional(),
        player: z.string().optional(),
        status: z.string().optional().describe("Out, Doubtful, Questionable"),
        refresh,
      },
    },
    run((a) => injuryReports(a, { refresh: a.refresh })),
  );

  // ---------------- league history ----------------
  server.registerTool(
    "league_history_sync",
    {
      title: "Sync league history from Sleeper",
      description:
        "Pull every season of the Sleeper league (following previous_league_id) into the local database: drafts, waiver/FAAB claims (won and lost), free-agent moves, trades, weekly matchups, standings and playoff results. Finished seasons are skipped unless force=true; the current season always refreshes.",
      inputSchema: {
        league_id: z.string().optional().describe(`Sleeper league id (default ${DEFAULT_LEAGUE_ID}).`),
        force: z.boolean().optional(),
      },
    },
    run(async (a) => ({ dbPath: defaultDbPath(), ...(await syncLeagueHistory(getDb(), a.league_id ?? DEFAULT_LEAGUE_ID, { force: a.force })) })),
  );

  server.registerTool(
    "league_history_status",
    {
      title: "League history: what's stored",
      description: "Seasons stored locally, when each was synced, and the managers (with every team name they've used).",
      inputSchema: {},
    },
    run(() => ({ dbPath: defaultDbPath(), ...syncStatus(getDb()), managers: listManagers(getDb()) })),
  );

  server.registerTool(
    "manager_tendencies",
    {
      title: "League-mate tendencies",
      description:
        "Profile of one manager (or everyone): all-time record and finishes, FAAB habits (spend, big bids, how much they overbid the next-best bid, early-season spending), panic drops and churn, trade volume and partners, and draft habits (first QB/TE round, early-round position mix). Ends with plain-English tendencies.",
      inputSchema: { manager: manager.optional(), season },
    },
    run((a) => managerTendencies(getDb(), a)),
  );

  server.registerTool(
    "faab_history",
    {
      title: "FAAB bid history",
      description: "Waiver claims with bids, what was dropped, and the best competing bid. Filter by manager, season, player or minimum bid.",
      inputSchema: {
        manager: manager.optional(),
        season,
        player: z.string().optional(),
        min_bid: z.number().optional(),
        include_failed: z.boolean().optional().describe("Include losing bids too."),
        limit: z.number().int().optional(),
      },
    },
    run((a) => faabHistory(getDb(), { ...a, minBid: a.min_bid, includeFailed: a.include_failed })),
  );

  server.registerTool(
    "trade_history",
    {
      title: "Trade history",
      description: "Completed trades with what each side received (players, draft picks, FAAB).",
      inputSchema: { manager: manager.optional(), season, limit: z.number().int().optional() },
    },
    run((a) => tradeHistory(getDb(), a)),
  );

  server.registerTool(
    "draft_history",
    {
      title: "Draft history",
      description: "Past draft picks (with keepers and auction prices). Filter by season, manager, position or max round.",
      inputSchema: { season, manager: manager.optional(), max_round: z.number().int().optional(), position: z.string().optional() },
    },
    run((a) => draftHistory(getDb(), { ...a, maxRound: a.max_round })),
  );

  server.registerTool(
    "head_to_head",
    {
      title: "Head-to-head record",
      description: "All-time head-to-head record and every game between two managers.",
      inputSchema: { a: manager, b: manager },
    },
    run((a) => headToHead(getDb(), a)),
  );

  server.registerTool(
    "league_history_sql",
    {
      title: "Query league history (SQL)",
      description: `Run one read-only SELECT against the league history database for questions the other tools don't cover. ${SCHEMA_DOC}`,
      inputSchema: { sql: z.string() },
    },
    run((a) => runReadOnlySql(openDb(defaultDbPath(), { readOnly: true }), a.sql)),
  );
}
