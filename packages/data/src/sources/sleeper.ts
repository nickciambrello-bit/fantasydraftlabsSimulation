// Sleeper's player list (GET /v1/players/nfl, ~5 MB, Sleeper asks for at most
// one call per day) is the live status layer: current team, injury status and
// depth chart. Its terms are non-commercial; revisit before charging money.

import { dstPlayerId, teamFromSleeper } from "../teams";

export const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";

export type SleeperPlayer = {
  player_id: string;
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  position?: string | null;
  team?: string | null;
  status?: string | null;
  injury_status?: string | null;
  depth_chart_order?: number | null;
  gsis_id?: string | null;
  espn_id?: string | number | null;
  yahoo_id?: string | number | null;
  birth_date?: string | null;
};

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"]);

export type SleeperUpdate = {
  player_id: string;
  name: string;
  position: string | null;
  team: string | null;
  sleeper_id: string;
  sleeper_status: string | null;
  sleeper_injury_status: string | null;
  sleeper_depth_order: number | null;
  /** True when no nflverse player matched and this row creates one. */
  isNew: boolean;
  espn_id: string | null;
  yahoo_id: string | null;
  birth_date: string | null;
};

/**
 * Resolve each Sleeper player to our player_id: by an existing sleeper_id
 * link first, then by gsis_id. Team defenses become DST_<team>. Players
 * nflverse has never seen (fresh signings) get SL_<sleeper id>.
 */
export function resolveSleeperPlayers(
  players: Record<string, SleeperPlayer>,
  existingBySleeperId: Map<string, string>,
  existingPlayerIds: Set<string>
): SleeperUpdate[] {
  const out: SleeperUpdate[] = [];
  const claimed = new Set<string>();

  for (const p of Object.values(players)) {
    const position = p.position ?? null;
    if (!position || !FANTASY_POSITIONS.has(position)) continue;
    // Skip long-retired players with no team and no active status.
    if (!p.team && p.status !== "Active" && position !== "DEF") continue;

    let playerId: string | null = null;
    let isNew = false;
    const team = teamFromSleeper(p.team);

    if (position === "DEF") {
      const defTeam = teamFromSleeper(p.player_id);
      if (!defTeam) continue;
      playerId = dstPlayerId(defTeam);
      isNew = !existingPlayerIds.has(playerId);
    } else {
      playerId = existingBySleeperId.get(p.player_id) ?? null;
      const gsis = p.gsis_id?.trim() || null;
      if (!playerId && gsis && existingPlayerIds.has(gsis)) playerId = gsis;
      if (!playerId) {
        playerId = `SL_${p.player_id}`;
        isNew = !existingPlayerIds.has(playerId);
      }
    }
    if (claimed.has(playerId)) continue;
    claimed.add(playerId);

    const name =
      position === "DEF"
        ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim() || `${team} Defense`
        : p.full_name ?? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();

    out.push({
      player_id: playerId,
      name,
      position,
      team: position === "DEF" ? teamFromSleeper(p.player_id) : team,
      sleeper_id: p.player_id,
      sleeper_status: p.status ?? null,
      sleeper_injury_status: p.injury_status ?? null,
      sleeper_depth_order: p.depth_chart_order ?? null,
      isNew,
      espn_id: p.espn_id != null ? String(p.espn_id) : null,
      yahoo_id: p.yahoo_id != null ? String(p.yahoo_id) : null,
      birth_date: p.birth_date ?? null,
    });
  }
  return out;
}
