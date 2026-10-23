// Thin wrappers around Sleeper's public, read-only API.
// Docs: https://docs.sleeper.com/

export type SleeperLeague = {
  league_id: string;
  name: string;
  season: string;
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: Record<string, number>;
};

export type SleeperDraft = {
  draft_id: string;
  type: "snake" | "linear" | "auction";
  status: string;
  settings: { rounds?: number };
};

export async function fetchSleeperLeague(
  sleeperLeagueId: string
): Promise<SleeperLeague> {
  const res = await fetch(
    `https://api.sleeper.app/v1/league/${sleeperLeagueId}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error("Could not load league settings from Sleeper.");
  return res.json();
}

export async function fetchSleeperDrafts(
  sleeperLeagueId: string
): Promise<SleeperDraft[]> {
  const res = await fetch(
    `https://api.sleeper.app/v1/league/${sleeperLeagueId}/drafts`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  return res.json();
}

export type SleeperDraftDetail = {
  draft_id: string;
  type: "snake" | "linear" | "auction";
  status: string;
  season: string;
  settings: { rounds?: number };
  draft_order: Record<string, number> | null; // sleeper_user_id -> slot
  slot_to_roster_id: Record<string, number> | null; // slot (as string) -> roster_id
};

export type SleeperTradedPick = {
  season: string;
  round: number;
  roster_id: number; // original owner's roster_id
  previous_owner_id: number;
  owner_id: number; // current owner's roster_id
};

export async function fetchSleeperTradedPicks(
  sleeperLeagueId: string
): Promise<SleeperTradedPick[]> {
  const res = await fetch(
    `https://api.sleeper.app/v1/league/${sleeperLeagueId}/traded_picks`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  return res.json();
}

export async function fetchSleeperDraftDetail(
  draftId: string
): Promise<SleeperDraftDetail> {
  const res = await fetch(`https://api.sleeper.app/v1/draft/${draftId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Could not load draft detail from Sleeper.");
  return res.json();
}

// Turns Sleeper's raw scoring_settings into a human label like "PPR" / "Half-PPR".
export function deriveScoringType(scoringSettings: Record<string, number>): string {
  const rec = scoringSettings?.rec ?? 0;
  if (rec === 1) return "PPR";
  if (rec === 0.5) return "Half-PPR";
  if (rec === 0) return "Standard";
  return `Custom (${rec} pts/reception)`;
}

// Turns Sleeper's roster_positions array (one entry per roster spot) into counts,
// e.g. ["QB","RB","RB","WR","WR","TE","FLEX","BN","BN"] -> { QB:1, RB:2, WR:2, TE:1, FLEX:1, BN:2 }
export function summarizeRosterPositions(
  positions: string[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const pos of positions) {
    counts[pos] = (counts[pos] ?? 0) + 1;
  }
  return counts;
}

export type SleeperLeagueBasic = {
  league_id: string;
  season: string;
  previous_league_id: string | null;
};

export type SleeperUser = {
  user_id: string;
  display_name: string;
  metadata?: { team_name?: string };
};

export type SleeperRoster = {
  roster_id: number;
  owner_id: string | null;
  players: string[] | null; // current roster — player_ids on this team right now
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_against?: number;
  };
};

export type SleeperDraftPick = {
  round: number;
  pick_no: number;
  draft_slot: number;
  roster_id: number;
  player_id: string;
  is_keeper: boolean | null;
  metadata: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
  };
};

export async function fetchSleeperLeagueBasic(
  sleeperLeagueId: string
): Promise<SleeperLeagueBasic> {
  const res = await fetch(
    `https://api.sleeper.app/v1/league/${sleeperLeagueId}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error(`Could not load league ${sleeperLeagueId} from Sleeper.`);
  return res.json();
}

// Walks the previous_league_id chain backward to find every past season,
// starting from (and including) the given league. Capped to avoid infinite loops.
export async function fetchLeagueSeasonChain(
  startingLeagueId: string,
  maxSeasons = 10
): Promise<SleeperLeagueBasic[]> {
  const chain: SleeperLeagueBasic[] = [];
  let currentId: string | null = startingLeagueId;

  while (currentId && chain.length < maxSeasons) {
    const league: SleeperLeagueBasic = await fetchSleeperLeagueBasic(currentId);
    chain.push(league);
    currentId = league.previous_league_id || null;
  }

  return chain;
}

export async function fetchSleeperUsers(
  sleeperLeagueId: string
): Promise<SleeperUser[]> {
  const res = await fetch(
    `https://api.sleeper.app/v1/league/${sleeperLeagueId}/users`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  return res.json();
}

export async function fetchSleeperRosters(
  sleeperLeagueId: string
): Promise<SleeperRoster[]> {
  const res = await fetch(
    `https://api.sleeper.app/v1/league/${sleeperLeagueId}/rosters`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  return res.json();
}

// A league can technically have multiple drafts; we use the most recent one.
export async function fetchSleeperDraftPicks(
  sleeperLeagueId: string
): Promise<SleeperDraftPick[]> {
  const drafts = await fetchSleeperDrafts(sleeperLeagueId);
  if (drafts.length === 0) return [];

  const res = await fetch(
    `https://api.sleeper.app/v1/draft/${drafts[0].draft_id}/picks`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  return res.json();
}

// Builds a lookup of roster_id -> a display name for that team's manager,
// preferring their custom team name over their Sleeper username.
export function buildManagerNameLookup(
  users: SleeperUser[],
  rosters: SleeperRoster[]
): Record<number, { name: string; sleeperUserId: string | null }> {
  const userById = new Map(users.map((u) => [u.user_id, u]));
  const lookup: Record<number, { name: string; sleeperUserId: string | null }> = {};

  for (const roster of rosters) {
    const user = roster.owner_id ? userById.get(roster.owner_id) : undefined;
    const name =
      user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`;
    lookup[roster.roster_id] = {
      name,
      sleeperUserId: roster.owner_id,
    };
  }

  return lookup;
}

