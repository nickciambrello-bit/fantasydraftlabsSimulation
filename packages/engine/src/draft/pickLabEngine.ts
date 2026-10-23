// Pick Lab: given a hypothetical pick and the REAL current draft state,
// branch-simulates the rest of the draft many times to see what's likely
// available at your NEXT pick — the core "what happens if I take this"
// mechanic. Built on the same primitives as the mock/live draft engine,
// so behavior stays consistent everywhere in the app.

import { defaultRng, type Rng } from "../rng";
import { pickForManager, roundBucket, type RankingRow, type ManagerProfile } from "./mockDraftEngine";

const CORE_POSITIONS = ["QB", "RB", "WR", "TE"];

export type RemainingPick = { round: number; seat: number };

export type NextPickOutlook = {
  topAvailable: { rank: number; name: string; position: string | null; availabilityPct: number }[];
  positionSummary: Record<string, { avgBestRank: number; pctTop12: number }>;
};

// Runs K simulations of "the rest of the draft after this hypothetical
// pick," stopping each run as soon as it reaches the user's NEXT turn, and
// aggregates what's available at that point.
export function simulateNextPickOutlook(
  candidate: RankingRow,
  availableBeforeCandidate: RankingRow[],
  remainingPicks: RemainingPick[], // pick_order entries AFTER the current pick, each with its round
  profileForSeatRound: (round: number, seat: number) => ManagerProfile | null,
  isLockedForSeatRound: (round: number, seat: number) => boolean,
  userDraftSlot: number,
  draftedCountsBySeatSoFar: Record<number, Record<string, number>>,
  numSimulations: number,
  rng: Rng = defaultRng
): { outlook: NextPickOutlook; picksUntilNext: number } {
  const availablePool = availableBeforeCandidate.filter((p) => p.rank !== candidate.rank);

  // How many picks until the user is up again (for display — doesn't
  // affect the simulation itself).
  const picksUntilNext = remainingPicks.findIndex((p) => p.seat === userDraftSlot);

  const rankCounts: Record<number, number> = {};
  const positionBestRanks: Record<string, number[]> = {};
  let simsCompleted = 0;

  for (let sim = 0; sim < numSimulations; sim++) {
    const available = [...availablePool];
    const draftedCounts: Record<number, Record<string, number>> = {};
    for (const seat of Object.keys(draftedCountsBySeatSoFar)) {
      draftedCounts[Number(seat)] = { ...draftedCountsBySeatSoFar[Number(seat)] };
    }

    let reachedUserPick = false;

    for (const { round, seat } of remainingPicks) {
      if (isLockedForSeatRound(round, seat)) continue; // keeper round, no open pick

      if (seat === userDraftSlot) {
        // This is the user's next real turn — snapshot what's left and stop.
        for (const player of available) {
          rankCounts[player.rank] = (rankCounts[player.rank] ?? 0) + 1;
        }
        const bestByPos: Record<string, number> = {};
        for (const player of available) {
          const pos = player.position ?? "UNKNOWN";
          if (!(pos in bestByPos) || player.rank < bestByPos[pos]) bestByPos[pos] = player.rank;
        }
        for (const pos of Object.keys(bestByPos)) {
          positionBestRanks[pos] ??= [];
          positionBestRanks[pos].push(bestByPos[pos]);
        }
        reachedUserPick = true;
        break;
      }

      if (available.length === 0) continue;
      const profile = profileForSeatRound(round, seat);
      draftedCounts[seat] ??= {};
      const chosen = pickForManager(available, profile, round, draftedCounts[seat], rng);
      const idx = available.findIndex((p) => p.rank === chosen.rank);
      if (idx >= 0) available.splice(idx, 1);
      const pos = chosen.position ?? "UNKNOWN";
      draftedCounts[seat][pos] = (draftedCounts[seat][pos] ?? 0) + 1;
    }

    if (reachedUserPick) simsCompleted++;
  }

  const denom = Math.max(1, simsCompleted);

  const topAvailable = Object.entries(rankCounts)
    .map(([rank, count]) => {
      const player = availablePool.find((p) => p.rank === Number(rank))!;
      return {
        rank: Number(rank),
        name: player.name,
        position: player.position,
        availabilityPct: Math.round((count / denom) * 1000) / 10,
      };
    })
    .filter((r) => r.availabilityPct >= 10)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 15);

  const positionSummary: Record<string, { avgBestRank: number; pctTop12: number }> = {};
  for (const pos of CORE_POSITIONS) {
    const ranks = positionBestRanks[pos];
    if (!ranks || ranks.length === 0) continue;
    const avg = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    const pctTop12 = Math.round((ranks.filter((r) => r <= 12).length / denom) * 1000) / 10;
    positionSummary[pos] = { avgBestRank: Math.round(avg * 10) / 10, pctTop12 };
  }

  return { outlook: { topAvailable, positionSummary }, picksUntilNext };
}

// Turns the simulated outlook into a plain-language reason — functionality
// first, wording can be refined later.
export function buildReasonText(
  candidate: RankingRow,
  outlook: NextPickOutlook,
  picksUntilNext: number
): { text: string; risk: "Low" | "Medium" | "High" } {
  const others = CORE_POSITIONS.filter((p) => p !== candidate.position);
  const worst = others
    .map((pos) => ({ pos, pct: outlook.positionSummary[pos]?.pctTop12 ?? 0 }))
    .sort((a, b) => a.pct - b.pct)[0];

  const untilText = picksUntilNext >= 0 ? `${picksUntilNext} other picks happen before you're up again.` : "";

  if (!worst || worst.pct >= 50) {
    return {
      text: `Safe pick — every other core position still has a good (${worst?.pct ?? 100}%+) chance of a top-12 option at your next turn. ${untilText}`,
      risk: "Low",
    };
  }
  if (worst.pct >= 20) {
    return {
      text: `Moderate risk — ${worst.pos} thins out some by your next pick (${worst.pct}% chance a top-12 option remains). ${untilText}`,
      risk: "Medium",
    };
  }
  return {
    text: `Real cost here — ${worst.pos} is very likely gone by your next pick (only ${worst.pct}% chance a top-12 option remains) if you don't address it now. ${untilText}`,
    risk: "High",
  };
}
