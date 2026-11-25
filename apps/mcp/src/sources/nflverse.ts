// nflverse-data release files (https://github.com/nflverse/nflverse-data).
// Free, no key. Files are rebuilt nightly-to-weekly in season, so every
// response says when we downloaded it and the newest week it contains.

import { memoize } from "../http.js";
import { num, streamCsv, type Row } from "../csv.js";
import { findTeam } from "../teams.js";

const BASE = "https://github.com/nflverse/nflverse-data/releases/download";
// Big files are held in memory for a short time so a burst of tool calls
// doesn't re-download 50 MB each time. Pass refresh: true to force a fetch.
const TTL_SHORT = 30 * 60 * 1000;
const TTL_LONG = 6 * 60 * 60 * 1000;

export type Opts = { refresh?: boolean };

export const urls = {
  schedules: `${BASE}/schedules/games.csv`,
  snaps: (season: number) => `${BASE}/snap_counts/snap_counts_${season}.csv`,
  ngs: (kind: NgsKind) => `${BASE}/nextgen_stats/ngs_${kind}.csv.gz`,
  participation: (season: number) => `${BASE}/pbp_participation/pbp_participation_${season}.csv`,
  injuries: (season: number) => `${BASE}/injuries/injuries_${season}.csv`,
  depthCharts: (season: number) => `${BASE}/depth_charts/depth_charts_${season}.csv`,
};

async function loadRows(url: string, ttl: number, opts: Opts, keep?: (r: Row) => boolean) {
  return memoize(
    url + (keep ? "#filtered" : ""),
    ttl,
    async () => {
      const rows: Row[] = [];
      await streamCsv(url, (r) => {
        if (!keep || keep(r)) rows.push(r);
      });
      return rows;
    },
    opts,
  );
}

const teamFilter = (team?: string) => {
  if (!team) return () => true;
  const t = findTeam(team);
  if (!t) throw new Error(`Unknown team "${team}"`);
  return (abbr: string) => (findTeam(abbr)?.abbr ?? abbr) === t.abbr;
};

const nameMatch = (needle?: string) => {
  if (!needle) return () => true;
  const n = needle.toLowerCase().replace(/[^a-z ]/g, "");
  return (name: string) => name.toLowerCase().replace(/[^a-z ]/g, "").includes(n);
};

// ---------- schedules (also carries closing-ish lines, roof, stadium) ----------

export type Game = {
  game_id: string;
  season: number;
  week: number;
  game_type: string;
  gameday: string;
  gametime: string; // ET, HH:MM
  away_team: string;
  home_team: string;
  away_score: number | null;
  home_score: number | null;
  spread_line: number | null; // positive = home favored by that many
  total_line: number | null;
  roof: string;
  stadium_id: string;
  stadium: string;
  espn: string;
};

export async function getSchedule(opts: Opts = {}) {
  const { value, fetchedAt, cached } = await memoize(
    urls.schedules,
    TTL_SHORT,
    async () => {
      const games: Game[] = [];
      await streamCsv(urls.schedules, (r) => {
        const season = Number(r.season);
        if (season < 2015) return;
        games.push({
          game_id: r.game_id,
          season,
          week: Number(r.week),
          game_type: r.game_type,
          gameday: r.gameday,
          gametime: r.gametime,
          away_team: r.away_team,
          home_team: r.home_team,
          away_score: num(r.away_score),
          home_score: num(r.home_score),
          spread_line: num(r.spread_line),
          total_line: num(r.total_line),
          roof: r.roof,
          stadium_id: r.stadium_id,
          stadium: r.stadium,
          espn: r.espn,
        });
      });
      return games;
    },
    opts,
  );
  return { games: value, fetchedAt, cached };
}

/** The current NFL week: the earliest week that still has an unplayed game. */
export function currentWeek(games: Game[], now = new Date()): { season: number; week: number } {
  const today = now.toISOString().slice(0, 10);
  const upcoming = games
    .filter((g) => g.home_score === null && g.gameday >= today)
    .sort((a, b) => (a.gameday < b.gameday ? -1 : 1));
  if (upcoming.length) return { season: upcoming[0].season, week: upcoming[0].week };
  const last = games.reduce((a, b) => (a.gameday > b.gameday ? a : b));
  return { season: last.season, week: last.week };
}

export async function gamesForWeek(season?: number, week?: number, opts: Opts = {}) {
  const sched = await getSchedule(opts);
  const cur = currentWeek(sched.games);
  const s = season ?? cur.season;
  const w = week ?? (s === cur.season ? cur.week : 1);
  const games = sched.games.filter((g) => g.season === s && g.week === w);
  return { season: s, week: w, games, fetchedAt: sched.fetchedAt };
}

/** NFL season year for a date (Jan-Feb games belong to the previous season). */
export function seasonFor(date = new Date()): number {
  return date.getUTCMonth() < 2 ? date.getUTCFullYear() - 1 : date.getUTCFullYear();
}

// ---------- snap counts ----------

export async function snapCounts(
  args: { season?: number; team?: string; player?: string; position?: string; weeks?: number; minPct?: number },
  opts: Opts = {},
) {
  const season = args.season ?? seasonFor();
  const isTeam = teamFilter(args.team);
  const isPlayer = nameMatch(args.player);
  const { value, fetchedAt } = await loadRows(urls.snaps(season), TTL_SHORT, opts);
  const rows = value.filter(
    (r) => isTeam(r.team) && isPlayer(r.player) && (!args.position || r.position === args.position.toUpperCase()),
  );
  const maxWeek = rows.reduce((m, r) => Math.max(m, Number(r.week)), 0);
  const lastN = args.weeks ?? 4;
  const byPlayer = new Map<string, { player: string; position: string; team: string; weeks: Record<string, number> }>();
  for (const r of rows) {
    if (Number(r.offense_snaps) === 0 && !args.player) continue;
    const key = r.pfr_player_id || r.player;
    const p = byPlayer.get(key) ?? { player: r.player, position: r.position, team: r.team, weeks: {} };
    p.team = r.team;
    p.weeks[r.week] = Math.round((num(r.offense_pct) ?? 0) * 100);
    byPlayer.set(key, p);
  }
  const players = [...byPlayer.values()]
    .map((p) => {
      const recent = Object.entries(p.weeks)
        .filter(([w]) => Number(w) > maxWeek - lastN)
        .map(([, v]) => v);
      const all = Object.values(p.weeks);
      const avg = (a: number[]) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);
      return {
        ...p,
        recent_avg_offense_pct: avg(recent),
        season_avg_offense_pct: avg(all),
        trend: avg(recent) - avg(all),
      };
    })
    .filter((p) => p.recent_avg_offense_pct >= (args.minPct ?? (args.player ? 0 : 10)))
    .sort((a, b) => b.recent_avg_offense_pct - a.recent_avg_offense_pct);
  return { source: urls.snaps(season), fetchedAt, season, latestWeekInData: maxWeek, recentWeeks: lastN, players: players.slice(0, 60) };
}

// ---------- Next Gen Stats ----------

export type NgsKind = "receiving" | "passing" | "rushing";

const NGS_FIELDS: Record<NgsKind, string[]> = {
  receiving: ["avg_cushion", "avg_separation", "avg_intended_air_yards", "percent_share_of_intended_air_yards", "targets", "receptions", "catch_percentage", "yards", "rec_touchdowns", "avg_yac", "avg_yac_above_expectation"],
  passing: ["avg_time_to_throw", "avg_completed_air_yards", "avg_intended_air_yards", "avg_air_yards_differential", "aggressiveness", "max_completed_air_distance", "avg_air_yards_to_sticks", "attempts", "pass_yards", "pass_touchdowns", "interceptions", "passer_rating", "completion_percentage", "expected_completion_percentage", "completion_percentage_above_expectation"],
  rushing: ["efficiency", "percent_attempts_gte_eight_defenders", "avg_time_to_los", "rush_attempts", "rush_yards", "expected_rush_yards", "rush_yards_over_expected", "avg_rush_yards", "rush_yards_over_expected_per_att", "rush_pct_over_expected", "rush_touchdowns"],
};

export async function nextGenStats(
  args: { kind: NgsKind; season?: number; week?: number; team?: string; player?: string; limit?: number },
  opts: Opts = {},
) {
  const season = args.season ?? seasonFor();
  const isTeam = teamFilter(args.team);
  const isPlayer = nameMatch(args.player);
  const { value, fetchedAt } = await loadRows(urls.ngs(args.kind), TTL_LONG, opts, (r) => Number(r.season) === season);
  const latestWeek = value.reduce((m, r) => Math.max(m, Number(r.week)), 0);
  // week 0 = season-to-date totals
  const week = args.week ?? 0;
  const rows = value
    .filter((r) => Number(r.week) === week && isTeam(r.team_abbr) && isPlayer(r.player_display_name))
    .map((r) => {
      const out: Record<string, string | number | null> = {
        player: r.player_display_name,
        position: r.player_position,
        team: r.team_abbr,
        week: Number(r.week),
      };
      for (const f of NGS_FIELDS[args.kind]) out[f] = round(num(r[f]));
      return out;
    });
  const sortKey = { receiving: "targets", passing: "attempts", rushing: "rush_attempts" }[args.kind];
  rows.sort((a, b) => Number(b[sortKey] ?? 0) - Number(a[sortKey] ?? 0));
  return {
    source: urls.ngs(args.kind),
    fetchedAt,
    season,
    week: week === 0 ? "season to date" : week,
    latestWeekInData: latestWeek,
    rows: rows.slice(0, args.limit ?? 40),
  };
}

const round = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

// ---------- participation (personnel and coverage) ----------

export async function participationProfile(
  args: { team: string; season?: number; side: "offense" | "defense"; weeks?: number[] },
  opts: Opts = {},
) {
  const season = args.season ?? seasonFor();
  const t = findTeam(args.team);
  if (!t) throw new Error(`Unknown team "${args.team}"`);
  let loaded;
  try {
    loaded = await memoize(
      urls.participation(season) + "#agg",
      TTL_LONG,
      async () => {
        // Keep only the columns we aggregate, to stay light on memory.
        const rows: Row[] = [];
        await streamCsv(urls.participation(season), (r) =>
          rows.push({
            game: r.nflverse_game_id,
            off: r.possession_team,
            formation: r.offense_formation,
            personnel: r.offense_personnel,
            grouping: personnelGroup(r.offense_personnel),
            box: r.defenders_in_box,
            rushers: r.number_of_pass_rushers,
            manzone: r.defense_man_zone_type,
            coverage: r.defense_coverage_type,
            pressure: r.was_pressure,
            route: r.route,
          }),
        );
        return rows;
      },
      opts,
    );
  } catch (e) {
    if (String(e).includes("404")) {
      return {
        source: urls.participation(season),
        error: `nflverse has not published ${season} participation data yet. It usually arrives after the season. Try season ${season - 1}.`,
      };
    }
    throw e;
  }
  const week = (g: string) => Number(g.split("_")[1]);
  const plays = loaded.value.filter((r) => {
    if (isSpecialTeams(r.personnel)) return false;
    if (args.weeks && !args.weeks.includes(week(r.game))) return false;
    const off = findTeam(r.off)?.abbr ?? r.off;
    if (args.side === "offense") return off === t.abbr;
    const [, , away, home] = r.game.split("_");
    const teams = [findTeam(away)?.abbr, findTeam(home)?.abbr];
    return teams.includes(t.abbr) && off !== t.abbr;
  });
  const share = (key: keyof Row) => {
    const counts = new Map<string, number>();
    let n = 0;
    for (const p of plays) {
      const v = p[key];
      if (!v || v === "NA" || ((key === "box" || key === "rushers") && v === "0")) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
      n++;
    }
    return Object.fromEntries(
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([k, c]) => [k, `${Math.round((c / n) * 1000) / 10}%`]),
    );
  };
  const dropbacks = plays.filter((p) => p.pressure === "TRUE" || p.pressure === "FALSE");
  const pressureRate = dropbacks.length
    ? Math.round((dropbacks.filter((p) => p.pressure === "TRUE").length / dropbacks.length) * 1000) / 10
    : null;
  return {
    source: urls.participation(season),
    fetchedAt: loaded.fetchedAt,
    team: t.abbr,
    season,
    side: args.side,
    plays: plays.length,
    ...(args.side === "defense"
      ? {
          man_vs_zone: share("manzone"),
          coverage_shell: share("coverage"),
          pressure_rate_pct: pressureRate,
          defenders_in_box: share("box"),
          pass_rushers: share("rushers"),
        }
      : {
          personnel_groupings: share("grouping"),
          formation: share("formation"),
          routes_targeted: share("route"),
          pressure_allowed_pct: pressureRate,
        }),
  };
}

/** "1 C, 2 G, 1 QB, 1 RB, 2 T, 1 TE, 3 WR" -> "11" (RBs incl. FB, then TEs). Older files use "1 RB, 1 TE, 3 WR". */
export function personnelGroup(p: string): string {
  if (!p) return "";
  const count = (pos: string) => {
    const m = p.match(new RegExp(`(\\d+) ${pos}(?![A-Z])`));
    return m ? Number(m[1]) : 0;
  };
  return `${count("RB") + count("FB")}${count("TE")}`;
}

const isSpecialTeams = (p: string) => /\b\d+ (K|P|LS)\b/.test(p ?? "");

// ---------- official weekly injury reports ----------

export async function injuryReports(
  args: { season?: number; week?: number; team?: string; player?: string; status?: string },
  opts: Opts = {},
) {
  const season = args.season ?? seasonFor();
  const isTeam = teamFilter(args.team);
  const isPlayer = nameMatch(args.player);
  const { value, fetchedAt } = await loadRows(urls.injuries(season), TTL_SHORT, opts);
  const latestWeek = value.reduce((m, r) => Math.max(m, Number(r.week)), 0);
  const week = args.week ?? latestWeek;
  const rows = value
    .filter(
      (r) =>
        Number(r.week) === week &&
        isTeam(r.team) &&
        isPlayer(r.full_name) &&
        (!args.status || r.report_status.toLowerCase() === args.status.toLowerCase()),
    )
    .filter((r) => args.player || r.report_status || r.practice_status.startsWith("Did Not"))
    .map((r) => ({
      player: r.full_name,
      team: r.team,
      position: r.position,
      game_status: r.report_status || null,
      injury: r.report_primary_injury || r.practice_primary_injury || null,
      practice: r.practice_status || null,
    }));
  return {
    source: urls.injuries(season),
    fetchedAt,
    season,
    week,
    latestWeekInData: latestWeek,
    note:
      week < latestWeek
        ? undefined
        : "Official reports post Wed-Fri. For same-day news use espn_injuries and espn_news.",
    rows,
  };
}

// ---------- depth charts (nflverse copy of ESPN, used as a fallback) ----------

export async function nflverseDepthChart(args: { team: string; season?: number }, opts: Opts = {}) {
  const season = args.season ?? seasonFor();
  const t = findTeam(args.team);
  if (!t) throw new Error(`Unknown team "${args.team}"`);
  const isTeam = teamFilter(t.abbr);
  const { value, fetchedAt } = await loadRows(urls.depthCharts(season), TTL_SHORT, opts, (r) => isTeam(r.team));
  const latest = value.reduce((m, r) => (r.dt > m ? r.dt : m), "");
  const rows = value.filter((r) => r.dt === latest && ["QB", "RB", "WR", "TE", "K", "FB"].includes(r.pos_abb.replace(/\d/g, "")));
  // Each position can have several slots (e.g. WR has three spots in 3WR sets).
  // Label them WR1/WR2/WR3 in the order of their starter's rank.
  const slots = new Map<string, Row[]>();
  for (const r of rows.sort((a, b) => Number(a.pos_rank) - Number(b.pos_rank))) {
    const k = `${r.pos_abb}|${r.pos_slot}`;
    slots.set(k, [...(slots.get(k) ?? []), r]);
  }
  const byPos: Record<string, string[]> = {};
  const perPos = new Map<string, number>();
  for (const k of slots.keys()) perPos.set(k.split("|")[0], (perPos.get(k.split("|")[0]) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const [k, rs] of slots) {
    const pos = k.split("|")[0];
    const n = (seen.get(pos) ?? 0) + 1;
    seen.set(pos, n);
    byPos[(perPos.get(pos) ?? 1) > 1 ? `${pos}${n}` : pos] = rs.map((r) => r.player_name);
  }
  return { source: urls.depthCharts(season), fetchedAt, team: t.abbr, asOf: latest, depthChart: byPos };
}
