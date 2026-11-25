// Sleeper public API (https://docs.sleeper.com). No key. Always fetched live.

import { fetchJson } from "../http.js";

const BASE = "https://api.sleeper.app/v1";

export type SLeague = {
  league_id: string;
  previous_league_id: string | null;
  name: string;
  season: string;
  status: string;
  total_rosters: number;
  settings: Record<string, number | null | undefined>;
};
export type SUser = { user_id: string; display_name: string; metadata?: { team_name?: string } | null };
export type SRoster = {
  roster_id: number;
  owner_id: string | null;
  co_owners?: string[] | null;
  settings: Record<string, number | undefined>;
};
export type SMatchup = { roster_id: number; matchup_id: number | null; points: number | null };
export type STransaction = {
  transaction_id: string;
  type: "trade" | "free_agent" | "waiver" | "commissioner" | string;
  status: string;
  roster_ids: number[];
  creator: string;
  created: number;
  status_updated?: number;
  leg: number;
  adds: Record<string, number> | null;
  drops: Record<string, number> | null;
  settings?: { waiver_bid?: number; seq?: number } | null;
  waiver_budget?: { sender: number; receiver: number; amount: number }[];
  draft_picks?: { season: string; round: number; roster_id: number; previous_owner_id: number; owner_id: number }[];
  metadata?: { notes?: string } | null;
};
export type SDraft = { draft_id: string; type: string; status: string; season: string };
export type SPick = {
  round: number;
  pick_no: number;
  draft_slot: number;
  roster_id: number | null;
  picked_by: string;
  player_id: string;
  is_keeper: boolean | null;
  metadata?: { first_name?: string; last_name?: string; position?: string; team?: string; amount?: string };
};
export type SBracket = { r: number; m: number; t1: number | null; t2: number | null; w: number | null; l: number | null; p?: number };
export type SPlayer = { full_name?: string; first_name?: string; last_name?: string; position?: string; team?: string | null };

const get = async <T>(path: string) => (await fetchJson<T>(`${BASE}${path}`)).data;

export const sleeper = {
  league: (id: string) => get<SLeague>(`/league/${id}`),
  users: (id: string) => get<SUser[]>(`/league/${id}/users`),
  rosters: (id: string) => get<SRoster[]>(`/league/${id}/rosters`),
  matchups: (id: string, week: number) => get<SMatchup[]>(`/league/${id}/matchups/${week}`),
  transactions: (id: string, week: number) => get<STransaction[]>(`/league/${id}/transactions/${week}`),
  drafts: (id: string) => get<SDraft[]>(`/league/${id}/drafts`),
  picks: (draftId: string) => get<SPick[]>(`/draft/${draftId}/picks`),
  winnersBracket: (id: string) => get<SBracket[] | null>(`/league/${id}/winners_bracket`),
  losersBracket: (id: string) => get<SBracket[] | null>(`/league/${id}/losers_bracket`),
  players: () => get<Record<string, SPlayer>>(`/players/nfl`),
  state: () => get<{ season: string; week: number; season_type: string }>(`/state/nfl`),
};

export type SleeperClient = typeof sleeper;
