import { defaultRng, type Rng } from "../rng";

// Client-side port of the same pick-selection logic used by the Modal
// simulation engine (see app.py's pick_for_manager). Ported to run
// instantly in the browser during an interactive mock draft, instead of
// round-tripping to Modal for every single pick.

export type RankingRow = {
  rank: number;
  name: string;
  position: string | null;
  sleeper_player_id: string | null;
};

export type ManagerProfile = {
  key: string;
  name: string;
  early: Record<string, number>;
  mid: Record<string, number>;
  late: Record<string, number>;
  keeper_rounds: number[];
  reach_bias?: Record<string, number>;
};

export const SOFT_POSITION_CAPS: Record<string, number> = {
  QB: 3, RB: 7, WR: 7, TE: 3, K: 2, DEF: 2,
};
const CONSIDERATION_POOL_SIZE = 40;
const RANK_DECAY = 8.0;

export function roundBucket(round: number): "early" | "mid" | "late" {
  if (round <= 3) return "early";
  if (round <= 8) return "mid";
  return "late";
}

export function buildPickOrder(leagueSize: number, rounds: number, draftType: string): number[] {
  const order: number[] = [];
  for (let r = 1; r <= rounds; r++) {
    const seats = Array.from({ length: leagueSize }, (_, i) => i + 1);
    if (draftType === "snake" && r % 2 === 0) seats.reverse();
    order.push(...seats);
  }
  return order;
}

// Weighted-random pick, same shape as the Python version: rank-based
// desirability (exponential decay) x this manager's positional tendency in
// this round-bucket x a soft cap penalty once they've drafted a lot of one
// position already.
export function pickForManager(
  available: RankingRow[],
  profile: ManagerProfile | null,
  round: number,
  draftedCounts: Record<string, number>,
  rng: Rng = defaultRng
): RankingRow {
  const pool = available.slice(0, CONSIDERATION_POOL_SIZE);
  const bucket = roundBucket(round);
  const bucketCounts = profile ? profile[bucket] : {};

  const weights = pool.map((player) => {
    const pos = player.position ?? "UNKNOWN";
    const reachBias = profile?.reach_bias?.[pos] ?? 0;
    const effectiveRank = Math.max(1, player.rank - reachBias);
    const rankScore = Math.exp(-(effectiveRank - 1) / RANK_DECAY);
    const prefScore = (bucketCounts[pos] ?? 0) + 1;
    const cap = SOFT_POSITION_CAPS[pos];
    const capPenalty = cap !== undefined && (draftedCounts[pos] ?? 0) >= cap ? 0.05 : 1.0;
    return rankScore * prefScore * capPenalty;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}
