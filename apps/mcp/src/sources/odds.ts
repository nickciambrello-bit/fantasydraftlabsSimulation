// The Odds API (https://the-odds-api.com). Free tier: 500 credits/month.
// One call for spreads+totals across US books costs 2 credits (markets x regions),
// so ~250 refreshes a month. Set ODDS_API_KEY. Without a key we fall back to
// the lines in the nflverse schedule file, which update about once a day.

import { fetchJson, redact } from "../http.js";
import { findTeam } from "../teams.js";
import { gamesForWeek, type Opts } from "./nflverse.js";

type Outcome = { name: string; price: number; point?: number };
type Market = { key: "spreads" | "totals" | "h2h"; last_update: string; outcomes: Outcome[] };
type Bookmaker = { key: string; title: string; last_update: string; markets: Market[] };
export type OddsEvent = {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: Bookmaker[];
};

export type GameLine = {
  away: string;
  home: string;
  kickoff: string;
  favorite: string | null;
  spread: number | null; // points the favorite gives
  total: number | null;
  implied_points: Record<string, number> | null;
  books?: number;
  spread_range?: [number, number];
  total_range?: [number, number];
  last_update?: string;
};

const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Consensus (median across books) home spread and total for one event. */
export function summarizeEvent(ev: OddsEvent): GameLine {
  const homeSpreads: number[] = [];
  const totals: number[] = [];
  let lastUpdate = "";
  for (const b of ev.bookmakers) {
    for (const m of b.markets) {
      if (m.last_update > lastUpdate) lastUpdate = m.last_update;
      if (m.key === "spreads") {
        const h = m.outcomes.find((o) => o.name === ev.home_team);
        if (h?.point !== undefined) homeSpreads.push(h.point);
      } else if (m.key === "totals") {
        const o = m.outcomes.find((x) => x.name === "Over");
        if (o?.point !== undefined) totals.push(o.point);
      }
    }
  }
  const home = findTeam(ev.home_team)?.abbr ?? ev.home_team;
  const away = findTeam(ev.away_team)?.abbr ?? ev.away_team;
  const hs = median(homeSpreads);
  const total = median(totals);
  return {
    ...lineFrom(away, home, hs === null ? null : -hs, total),
    kickoff: ev.commence_time,
    books: ev.bookmakers.length,
    spread_range: homeSpreads.length ? [Math.min(...homeSpreads), Math.max(...homeSpreads)] : undefined,
    total_range: totals.length ? [Math.min(...totals), Math.max(...totals)] : undefined,
    last_update: lastUpdate || undefined,
  };
}

/** homeMargin: points the home team is expected to win by (nflverse spread_line convention). */
function lineFrom(away: string, home: string, homeMargin: number | null, total: number | null) {
  const favorite = homeMargin === null || homeMargin === 0 ? null : homeMargin > 0 ? home : away;
  const implied =
    homeMargin !== null && total !== null
      ? { [home]: Math.round(((total + homeMargin) / 2) * 10) / 10, [away]: Math.round(((total - homeMargin) / 2) * 10) / 10 }
      : null;
  return {
    away,
    home,
    kickoff: "",
    favorite,
    spread: homeMargin === null ? null : Math.abs(homeMargin),
    total,
    implied_points: implied,
  };
}

export async function getOdds(args: { team?: string }, opts: Opts = {}) {
  const key = process.env.ODDS_API_KEY;
  const team = args.team ? findTeam(args.team) : null;
  if (args.team && !team) throw new Error(`Unknown team "${args.team}"`);
  const want = (l: GameLine) => !team || l.home === team.abbr || l.away === team.abbr;

  if (key) {
    const url =
      `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds?regions=us&markets=spreads,totals` +
      `&oddsFormat=american&dateFormat=iso&apiKey=${encodeURIComponent(key)}`;
    const { data, fetchedAt, headers } = await fetchJson<OddsEvent[]>(url);
    // Only games in the next 8 days, i.e. this week's slate.
    const horizon = Date.now() + 8 * 24 * 3600 * 1000;
    const games = data
      .filter((e) => Date.parse(e.commence_time) < horizon)
      .map(summarizeEvent)
      .filter(want)
      .sort((a, b) => (a.kickoff < b.kickoff ? -1 : 1));
    return {
      source: redact(url),
      fetchedAt,
      quota: { remaining: headers.get("x-requests-remaining"), used: headers.get("x-requests-used") },
      note: "Spread and total are medians across US books. implied_points = (total +/- spread) / 2.",
      games,
    };
  }

  const wk = await gamesForWeek(undefined, undefined, opts);
  const games = wk.games
    .map((g) => ({
      ...lineFrom(g.away_team, g.home_team, g.spread_line, g.total_line),
      kickoff: `${g.gameday} ${g.gametime} ET`,
    }))
    .filter(want);
  return {
    source: "nflverse schedules (fallback: no ODDS_API_KEY set)",
    fetchedAt: wk.fetchedAt,
    season: wk.season,
    week: wk.week,
    note: "These are the lines in nflverse's schedule file, refreshed about daily. Set ODDS_API_KEY (free at the-odds-api.com) for live multi-book lines.",
    games,
  };
}
