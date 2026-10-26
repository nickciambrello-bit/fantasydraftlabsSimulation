// nflverse publishes nightly CSVs as GitHub release assets. These functions
// turn one CSV row into one database row; fetching and writing live in
// ingest.ts so the transforms stay pure and testable.

import { bool, int, num, str, type CsvRow } from "../values";

const RELEASES = "https://github.com/nflverse/nflverse-data/releases/download";

export const NFLVERSE_URLS = {
  players: `${RELEASES}/players/players.csv`,
  schedules: `${RELEASES}/schedules/games.csv`,
  // DynastyProcess ID map: the only free source linking gsis ids to Sleeper/Yahoo/MFL ids.
  idMap: "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv",
  weeklyStats: (season: number) => `${RELEASES}/stats_player/stats_player_week_${season}.csv`,
  snapCounts: (season: number) => `${RELEASES}/snap_counts/snap_counts_${season}.csv`,
  injuries: (season: number) => `${RELEASES}/injuries/injuries_${season}.csv`,
};

export type PlayerRow = {
  player_id: string;
  name: string;
  position: string | null;
  position_group: string | null;
  team: string | null;
  birth_date: string | null;
  rookie_season: number | null;
  status: string | null;
  headshot_url: string | null;
  sleeper_id: string | null;
  espn_id: string | null;
  yahoo_id: string | null;
  pfr_id: string | null;
  mfl_id: string | null;
  fantasypros_id: string | null;
};

/** Index the DynastyProcess ID map by gsis_id. */
export function indexIdMap(rows: CsvRow[]): Map<string, CsvRow> {
  const out = new Map<string, CsvRow>();
  for (const r of rows) {
    const gsis = str(r.gsis_id);
    if (gsis && !out.has(gsis)) out.set(gsis, r);
  }
  return out;
}

export function toPlayer(r: CsvRow, ids: Map<string, CsvRow>): PlayerRow | null {
  const playerId = str(r.gsis_id);
  const name = str(r.display_name);
  if (!playerId || !name) return null;
  const m = ids.get(playerId);
  return {
    player_id: playerId,
    name,
    position: str(r.position),
    position_group: str(r.position_group),
    team: str(r.latest_team),
    birth_date: str(r.birth_date),
    rookie_season: int(r.rookie_season),
    status: str(r.status),
    headshot_url: str(r.headshot),
    sleeper_id: str(m?.sleeper_id),
    espn_id: str(r.espn_id) ?? str(m?.espn_id),
    yahoo_id: str(m?.yahoo_id),
    pfr_id: str(r.pfr_id) ?? str(m?.pfr_id),
    mfl_id: str(m?.mfl_id),
    fantasypros_id: str(m?.fantasypros_id),
  };
}

/**
 * The ID map occasionally assigns one Sleeper id to two gsis ids. Keep the
 * first and null the rest so the unique constraint holds; the Sleeper loader
 * re-links by gsis_id anyway.
 */
export function dedupeSleeperIds(players: PlayerRow[]): PlayerRow[] {
  const seen = new Set<string>();
  return players.map((p) => {
    if (!p.sleeper_id) return p;
    if (seen.has(p.sleeper_id)) return { ...p, sleeper_id: null };
    seen.add(p.sleeper_id);
    return p;
  });
}

export function toGame(r: CsvRow) {
  const gameId = str(r.game_id);
  if (!gameId) return null;
  return {
    game_id: gameId,
    season: int(r.season)!,
    game_type: str(r.game_type) ?? "REG",
    week: int(r.week)!,
    gameday: str(r.gameday),
    gametime: str(r.gametime),
    away_team: str(r.away_team)!,
    home_team: str(r.home_team)!,
    away_score: int(r.away_score),
    home_score: int(r.home_score),
    spread_line: num(r.spread_line),
    total_line: num(r.total_line),
    away_moneyline: int(r.away_moneyline),
    home_moneyline: int(r.home_moneyline),
    div_game: bool(r.div_game),
    roof: str(r.roof),
    surface: str(r.surface),
    temp: int(r.temp),
    wind: int(r.wind),
  };
}

// Identity/descriptive columns that are never stats.
const NON_STAT_COLUMNS = new Set([
  "player_id", "player_name", "player_display_name", "position", "position_group",
  "headshot_url", "season", "week", "season_type", "game_id", "team", "opponent_team",
  "fg_made_list", "fg_missed_list", "fg_blocked_list",
  "fg_made_distance", "fg_missed_distance", "fg_blocked_distance", "gwfg_distance",
]);

export function toWeekStats(r: CsvRow) {
  const playerId = str(r.player_id);
  const season = int(r.season);
  const week = int(r.week);
  if (!playerId || season === null || week === null) return null;

  // Keep every other nonzero numeric stat so any league's scoring rules
  // (return yards, 40+ yd bonuses, IDP...) can be computed later.
  const raw: Record<string, number> = {};
  for (const [k, v] of Object.entries(r)) {
    if (NON_STAT_COLUMNS.has(k)) continue;
    const n = num(v);
    if (n !== null && n !== 0) raw[k] = n;
  }

  return {
    player_id: playerId,
    season,
    season_type: str(r.season_type) ?? "REG",
    week,
    game_id: str(r.game_id),
    team: str(r.team),
    opponent: str(r.opponent_team),
    position: str(r.position),
    completions: int(r.completions),
    attempts: int(r.attempts),
    passing_yards: int(r.passing_yards),
    passing_tds: int(r.passing_tds),
    passing_interceptions: int(r.passing_interceptions),
    sacks_suffered: int(r.sacks_suffered),
    passing_2pt_conversions: int(r.passing_2pt_conversions),
    carries: int(r.carries),
    rushing_yards: int(r.rushing_yards),
    rushing_tds: int(r.rushing_tds),
    rushing_2pt_conversions: int(r.rushing_2pt_conversions),
    targets: int(r.targets),
    receptions: int(r.receptions),
    receiving_yards: int(r.receiving_yards),
    receiving_tds: int(r.receiving_tds),
    receiving_air_yards: int(r.receiving_air_yards),
    receiving_2pt_conversions: int(r.receiving_2pt_conversions),
    target_share: num(r.target_share),
    air_yards_share: num(r.air_yards_share),
    fumbles_lost: int(r.fumbles_lost_total),
    special_teams_tds: int(r.special_teams_tds),
    fg_made: int(r.fg_made),
    fg_att: int(r.fg_att),
    pat_made: int(r.pat_made),
    pat_att: int(r.pat_att),
    fantasy_points: num(r.fantasy_points),
    fantasy_points_ppr: num(r.fantasy_points_ppr),
    raw,
  };
}

export function toSnapCount(r: CsvRow, playerIdByPfr: Map<string, string>) {
  const gameId = str(r.game_id);
  const pfr = str(r.pfr_player_id);
  if (!gameId || !pfr) return null;
  return {
    game_id: gameId,
    pfr_player_id: pfr,
    player_id: playerIdByPfr.get(pfr) ?? null,
    season: int(r.season)!,
    game_type: str(r.game_type) ?? "REG",
    week: int(r.week)!,
    team: str(r.team),
    position: str(r.position),
    offense_snaps: int(r.offense_snaps),
    offense_pct: num(r.offense_pct),
    defense_snaps: int(r.defense_snaps),
    defense_pct: num(r.defense_pct),
    st_snaps: int(r.st_snaps),
    st_pct: num(r.st_pct),
  };
}

export function toInjury(r: CsvRow) {
  const playerId = str(r.gsis_id);
  const season = int(r.season);
  const week = int(r.week);
  if (!playerId || season === null || week === null) return null;
  return {
    player_id: playerId,
    season,
    game_type: str(r.game_type) ?? "REG",
    week,
    team: str(r.team),
    report_status: str(r.report_status),
    report_primary_injury: str(r.report_primary_injury),
    practice_status: str(r.practice_status),
    practice_primary_injury: str(r.practice_primary_injury),
  };
}

/** Last row wins for duplicate primary keys, which Postgres rejects within one upsert. */
export function dedupeBy<T>(rows: T[], key: (row: T) => string): T[] {
  const m = new Map<string, T>();
  for (const r of rows) m.set(key(r), r);
  return [...m.values()];
}
