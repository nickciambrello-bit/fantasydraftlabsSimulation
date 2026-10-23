// Helpers for turning messy uploaded ranking rows into clean, matchable
// player records, and matching them against Sleeper's player database.

const SUFFIXES = ["jr", "sr", "ii", "iii", "iv", "v"];

// Strips punctuation, suffixes, and extra whitespace so names from different
// sources can be compared reliably, e.g. "Kenneth Walker III" and
// "Kenneth Walker" both normalize to "kenneth walker".
export function normalizePlayerName(raw: string): string {
  let name = raw
    .toLowerCase()
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = name.split(" ");
  if (parts.length > 1 && SUFFIXES.includes(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join(" ");
}

// FantasyPros-style combined column: "Jahmyr Gibbs   DET (6)"
// Extracts { name, team, byeWeek } from a single messy string.
export function extractNameTeamBye(raw: string): {
  name: string;
  team: string | null;
  byeWeek: number | null;
} {
  const byeMatch = raw.match(/\((\d{1,2})\)\s*$/);
  const byeWeek = byeMatch ? Number(byeMatch[1]) : null;

  let withoutBye = raw.replace(/\(\d{1,2}\)\s*$/, "").trim();

  // Last "word" before the (now-removed) bye is usually the team code, e.g. "DET".
  const teamMatch = withoutBye.match(/\s([A-Z]{2,4})\s*$/);
  const team = teamMatch ? teamMatch[1] : null;
  const name = team
    ? withoutBye.slice(0, withoutBye.length - team.length).trim()
    : withoutBye;

  return { name, team, byeWeek };
}

// FantasyPros-style position column: "RB1", "WR12" -> { position: "RB", posRank: 1 }
export function extractPositionRank(raw: string): {
  position: string;
  posRank: number | null;
} {
  const match = raw.match(/^([A-Za-z]+)(\d+)?$/);
  if (!match) return { position: raw.trim().toUpperCase(), posRank: null };
  return {
    position: match[1].toUpperCase(),
    posRank: match[2] ? Number(match[2]) : null,
  };
}

export type SleeperPlayerLite = {
  player_id: string;
  full_name: string;
  position: string | null;
  team: string | null;
  search_rank: number | null;
};

const FANTASY_POSITIONS = new Set(["QB", "RB", "WR", "TE", "K", "DEF"]);

// Fetches Sleeper's full player database and trims it to fantasy-relevant
// players only. This is a genuinely large payload (multiple MB), so it
// should only be called from server-side code, and only when needed —
// never on every page load.
export async function fetchSleeperPlayersLite(): Promise<SleeperPlayerLite[]> {
  const res = await fetch("https://api.sleeper.app/v1/players/nfl", {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Could not load Sleeper's player database.");
  const raw = await res.json();

  const players: SleeperPlayerLite[] = [];
  for (const id of Object.keys(raw)) {
    const p = raw[id];
    if (!p || !p.position || !FANTASY_POSITIONS.has(p.position)) continue;
    if (p.position !== "DEF" && !p.full_name) continue;

    players.push({
      player_id: id,
      full_name: p.position === "DEF" ? p.full_name ?? id : p.full_name,
      position: p.position,
      team: p.team ?? null,
      search_rank: typeof p.search_rank === "number" ? p.search_rank : null,
    });
  }
  return players;
}

// Builds a lookup from normalized name (+ position, when available) to a
// Sleeper player, for fast matching of uploaded ranking rows.
export function buildPlayerMatchIndex(players: SleeperPlayerLite[]) {
  const byNameAndPosition = new Map<string, SleeperPlayerLite>();
  const byNameOnly = new Map<string, SleeperPlayerLite>();

  for (const player of players) {
    const normalized = normalizePlayerName(player.full_name);
    if (player.position) {
      byNameAndPosition.set(`${normalized}|${player.position}`, player);
    }
    // Only keep a name-only fallback if it's unambiguous.
    if (!byNameOnly.has(normalized)) {
      byNameOnly.set(normalized, player);
    } else {
      byNameOnly.delete(normalized);
    }
  }

  return {
    match(name: string, position: string | null): SleeperPlayerLite | null {
      const normalized = normalizePlayerName(name);
      if (position) {
        const exact = byNameAndPosition.get(`${normalized}|${position}`);
        if (exact) return exact;
      }
      return byNameOnly.get(normalized) ?? null;
    },
  };
}
