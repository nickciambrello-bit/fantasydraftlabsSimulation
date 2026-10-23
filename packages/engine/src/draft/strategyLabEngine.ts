// Strategy Lab: instead of measuring availability passively (Draft Lab) or
// comparing one pick (Pick Lab), this drives the user's OWN picks according
// to a named strategy template for the whole draft, then compares the
// resulting rosters across strategies. Built on the same pick engine as
// everywhere else, so behavior stays consistent.

import { defaultRng, shuffle, type Rng } from "../rng";
import { pickForManager, buildPickOrder, SOFT_POSITION_CAPS, type RankingRow, type ManagerProfile } from "./mockDraftEngine";

export type StrategyRoundTarget = { fromRound: number; toRound: number; target: string }; // target: position or "BPA"

export const STRATEGY_PRESETS: Record<string, { label: string; description: string; rounds: StrategyRoundTarget[] }> = {
  hero_rb: {
    label: "Hero RB",
    description: "One elite RB anchor early, then attack WR value.",
    rounds: [
      { fromRound: 1, toRound: 1, target: "RB" },
      { fromRound: 2, toRound: 4, target: "WR" },
      { fromRound: 5, toRound: 99, target: "BPA" },
    ],
  },
  zero_rb: {
    label: "Zero RB",
    description: "Avoid RB entirely early, load up on WR/pass-catchers.",
    rounds: [
      { fromRound: 1, toRound: 4, target: "WR" },
      { fromRound: 5, toRound: 99, target: "BPA" },
    ],
  },
  robust_rb: {
    label: "Robust RB",
    description: "Prioritize RB depth in the first 3 rounds.",
    rounds: [
      { fromRound: 1, toRound: 3, target: "RB" },
      { fromRound: 4, toRound: 99, target: "BPA" },
    ],
  },
  wr_heavy: {
    label: "WR Heavy",
    description: "Prioritize WR depth in the first 3 rounds.",
    rounds: [
      { fromRound: 1, toRound: 3, target: "WR" },
      { fromRound: 4, toRound: 99, target: "BPA" },
    ],
  },
  balanced: {
    label: "Balanced (Best Value)",
    description: "No positional constraint — always take the best-ranked player available.",
    rounds: [{ fromRound: 1, toRound: 99, target: "BPA" }],
  },
};

function targetForRound(rounds: StrategyRoundTarget[], round: number): string {
  return rounds.find((r) => round >= r.fromRound && round <= r.toRound)?.target ?? "BPA";
}

function pickForStrategy(
  available: RankingRow[],
  target: string,
  draftedCountsSoFar: Record<string, number>
): RankingRow {
  if (target !== "BPA") {
    const match = available.find((p) => {
      if (p.position !== target) return false;
      const cap = SOFT_POSITION_CAPS[p.position];
      // Even when TARGETING a position, don't keep stacking it forever —
      // a real drafter wouldn't take a 4th QB just because the strategy
      // said "prioritize QB early."
      return cap === undefined || (draftedCountsSoFar[p.position] ?? 0) < cap;
    });
    if (match) return match;
  }
  // Best player available — but skipping any position the roster has
  // already filled up on. This is the piece that was missing: taking the
  // literal #1-ranked remaining player with zero regard for what's
  // already been drafted isn't how anyone actually drafts, and it's what
  // let a run of backup QBs pile up instead of a realistic mixed roster.
  for (const player of available) {
    const pos = player.position ?? "UNKNOWN";
    const cap = SOFT_POSITION_CAPS[pos];
    if (cap !== undefined && (draftedCountsSoFar[pos] ?? 0) >= cap) continue;
    return player;
  }
  return available[0]; // fallback: every position is capped, just take best available anyway
}

export type RosterEntry = { round: number; name: string; position: string | null; rank: number };

export function simulateStrategy(
  strategyKey: string,
  rankings: RankingRow[],
  managerProfiles: ManagerProfile[],
  leagueSize: number,
  rounds: number,
  draftType: string,
  userDraftSlot: number,
  fixedSeatAssignments: Record<number, string> | null,
  userKeeperRounds: number[],
  numSimulations: number,
  rng: Rng = defaultRng
): RosterEntry[][] {
  const preset = STRATEGY_PRESETS[strategyKey];
  const pickOrder = buildPickOrder(leagueSize, rounds, draftType);
  const byKey = new Map(managerProfiles.map((p) => [p.key, p]));
  const results: RosterEntry[][] = [];

  for (let sim = 0; sim < numSimulations; sim++) {
    const seatToProfile: Record<number, ManagerProfile | null> = {};
    if (fixedSeatAssignments) {
      for (let seat = 1; seat <= leagueSize; seat++) {
        if (seat === userDraftSlot) { seatToProfile[seat] = null; continue; }
        const key = fixedSeatAssignments[seat];
        seatToProfile[seat] = key ? byKey.get(key) ?? null : null;
      }
    } else {
      const shuffled = shuffle(managerProfiles, rng);
      let idx = 0;
      for (let seat = 1; seat <= leagueSize; seat++) {
        if (seat === userDraftSlot) { seatToProfile[seat] = null; continue; }
        seatToProfile[seat] = shuffled[idx] ?? null;
        idx++;
      }
    }

    const available = [...rankings];
    const draftedCounts: Record<number, Record<string, number>> = {};
    const userDraftedCounts: Record<string, number> = {};
    const roster: RosterEntry[] = [];

    let round = 0;
    let inRound = 0;

    for (const seat of pickOrder) {
      inRound++;
      if (inRound === 1) round++;
      if (inRound > leagueSize) { inRound = 1; round++; }

      if (seat === userDraftSlot) {
        if (userKeeperRounds.includes(round)) continue; // keeper already fills this round
        if (available.length === 0) continue;
        const target = targetForRound(preset.rounds, round);
        const chosen = pickForStrategy(available, target, userDraftedCounts);
        const idx = available.findIndex((p) => p.rank === chosen.rank);
        if (idx >= 0) available.splice(idx, 1);
        const pos = chosen.position ?? "UNKNOWN";
        userDraftedCounts[pos] = (userDraftedCounts[pos] ?? 0) + 1;
        roster.push({ round, name: chosen.name, position: chosen.position, rank: chosen.rank });
        continue;
      }

      if (available.length === 0) continue;
      const profile = seatToProfile[seat];
      if (profile && profile.keeper_rounds.includes(round)) continue;

      draftedCounts[seat] ??= {};
      const chosen = pickForManager(available, profile, round, draftedCounts[seat], rng);
      const idx = available.findIndex((p) => p.rank === chosen.rank);
      if (idx >= 0) available.splice(idx, 1);
      const pos = chosen.position ?? "UNKNOWN";
      draftedCounts[seat][pos] = (draftedCounts[seat][pos] ?? 0) + 1;
    }

    results.push(roster);
  }

  return results;
}

export type FullDraftTracking = {
  rosters: RosterEntry[][];
  // player name -> array of "drafted at this overall pick #" (or Infinity
  // if never drafted that sim), one entry per simulation, always aligned.
  pickTracking: Record<string, number[]>;
  // round -> { playerName -> count of sims the user landed them that round }
  userRoundConsensus: Record<number, Record<string, number>>;
};

// Like simulateStrategy("balanced", ...) but ALSO tracks, for every
// tracked player, which overall pick they were taken at in each
// simulation — the raw material for a Dynasty-Daddy-style "% available by
// pick" grid — plus what the user actually landed each round, aggregated
// across sims. Reuses the same full-draft loop so this can be called once
// instead of running the simulation twice for two different outputs.
export function simulateFullDraftTracking(
  rankings: RankingRow[],
  managerProfiles: ManagerProfile[],
  leagueSize: number,
  rounds: number,
  draftType: string,
  userDraftSlot: number,
  fixedSeatAssignments: Record<number, string> | null,
  userKeeperRounds: number[],
  numSimulations: number,
  trackTopN: number = 200,
  rng: Rng = defaultRng
): FullDraftTracking {
  const pickOrder = buildPickOrder(leagueSize, rounds, draftType);
  const byKey = new Map(managerProfiles.map((p) => [p.key, p]));
  const trackedNames = new Set(rankings.slice(0, trackTopN).map((p) => p.name));

  const rosters: RosterEntry[][] = [];
  const pickTracking: Record<string, number[]> = {};
  for (const name of trackedNames) pickTracking[name] = [];
  const userRoundConsensus: Record<number, Record<string, number>> = {};

  for (let sim = 0; sim < numSimulations; sim++) {
    const seatToProfile: Record<number, ManagerProfile | null> = {};
    if (fixedSeatAssignments) {
      for (let seat = 1; seat <= leagueSize; seat++) {
        if (seat === userDraftSlot) { seatToProfile[seat] = null; continue; }
        const key = fixedSeatAssignments[seat];
        seatToProfile[seat] = key ? byKey.get(key) ?? null : null;
      }
    } else {
      const shuffled = shuffle(managerProfiles, rng);
      let idx = 0;
      for (let seat = 1; seat <= leagueSize; seat++) {
        if (seat === userDraftSlot) { seatToProfile[seat] = null; continue; }
        seatToProfile[seat] = shuffled[idx] ?? null;
        idx++;
      }
    }

    const available = [...rankings];
    const draftedCounts: Record<number, Record<string, number>> = {};
    const userDraftedCounts: Record<string, number> = {};
    const roster: RosterEntry[] = [];
    const takenAtPickThisSim: Record<string, number> = {};

    let round = 0;
    let inRound = 0;
    let overall = 0;

    for (const seat of pickOrder) {
      inRound++;
      overall++;
      if (inRound === 1) round++;
      if (inRound > leagueSize) { inRound = 1; round++; }

      if (seat === userDraftSlot) {
        if (userKeeperRounds.includes(round)) continue;
        if (available.length === 0) continue;
        // Best available, but respecting roster construction — the same
        // fix as pickForStrategy: taking the literal #1-ranked remaining
        // player with no regard for what's already been drafted isn't
        // realistic, and let backup-tier players at an already-filled
        // position pile up unrealistically.
        const chosen = pickForStrategy(available, "BPA", userDraftedCounts);
        const idx = available.findIndex((p) => p.rank === chosen.rank);
        if (idx >= 0) available.splice(idx, 1);
        const pos = chosen.position ?? "UNKNOWN";
        userDraftedCounts[pos] = (userDraftedCounts[pos] ?? 0) + 1;
        roster.push({ round, name: chosen.name, position: chosen.position, rank: chosen.rank });
        takenAtPickThisSim[chosen.name] = overall;
        userRoundConsensus[round] ??= {};
        userRoundConsensus[round][chosen.name] = (userRoundConsensus[round][chosen.name] ?? 0) + 1;
        continue;
      }

      if (available.length === 0) continue;
      const profile = seatToProfile[seat];
      if (profile && profile.keeper_rounds.includes(round)) continue;

      draftedCounts[seat] ??= {};
      const chosen = pickForManager(available, profile, round, draftedCounts[seat], rng);
      const idx = available.findIndex((p) => p.rank === chosen.rank);
      if (idx >= 0) available.splice(idx, 1);
      const pos = chosen.position ?? "UNKNOWN";
      draftedCounts[seat][pos] = (draftedCounts[seat][pos] ?? 0) + 1;
      takenAtPickThisSim[chosen.name] = overall;
    }

    rosters.push(roster);
    for (const name of trackedNames) {
      pickTracking[name].push(takenAtPickThisSim[name] ?? Infinity);
    }
  }

  return { rosters, pickTracking, userRoundConsensus };
}


function estimatePPG(position: string | null, rank: number): number {
  const curves: Record<string, { base: number; slope: number; floor: number }> = {
    QB: { base: 24, slope: 0.15, floor: 12 },
    RB: { base: 22, slope: 0.12, floor: 4 },
    WR: { base: 20, slope: 0.10, floor: 4 },
    TE: { base: 15, slope: 0.20, floor: 3 },
    K: { base: 8.5, slope: 0.01, floor: 6 },
    DEF: { base: 8, slope: 0.01, floor: 5 },
  };
  const c = curves[position ?? ""] ?? { base: 10, slope: 0.1, floor: 2 };
  return Math.max(c.floor, Math.round((c.base - c.slope * (rank - 1)) * 10) / 10);
}

function computeLineup(roster: { position: string; ppg: number }[], rosterPositions: string[]) {
  const slotCounts: Record<string, number> = {};
  let flexCount = 0;
  for (const slot of rosterPositions) {
    if (slot === "BN" || slot === "IR" || slot === "TAXI") continue;
    if (slot === "FLEX") flexCount += 1;
    else slotCounts[slot] = (slotCounts[slot] ?? 0) + 1;
  }

  const pool = [...roster];
  const starters: { position: string; ppg: number }[] = [];

  function takeBest(predicate: (p: { position: string; ppg: number }) => boolean) {
    let bestIndex = -1;
    for (let i = 0; i < pool.length; i++) {
      if (!predicate(pool[i])) continue;
      if (bestIndex === -1 || pool[i].ppg > pool[bestIndex].ppg) bestIndex = i;
    }
    if (bestIndex === -1) return null;
    return pool.splice(bestIndex, 1)[0];
  }

  for (const pos of Object.keys(slotCounts)) {
    for (let i = 0; i < slotCounts[pos]; i++) {
      const p = takeBest((x) => x.position === pos);
      if (p) starters.push(p);
    }
  }
  for (let i = 0; i < flexCount; i++) {
    const p = takeBest((x) => ["RB", "WR", "TE"].includes(x.position));
    if (p) starters.push(p);
  }

  return starters.reduce((sum, p) => sum + p.ppg, 0);
}

// For one player, the % of simulations where they were STILL available
// at each overall pick number (1-indexed array, index 0 = pick 1).
export function availabilityByPick(
  pickTracking: Record<string, number[]>,
  playerName: string,
  totalPicks: number
): number[] {
  const takenAt = pickTracking[playerName];
  if (!takenAt || takenAt.length === 0) return [];
  const n = takenAt.length;
  const out: number[] = [];
  for (let pick = 1; pick <= totalPicks; pick++) {
    const stillAvailable = takenAt.filter((p) => p > pick).length;
    out.push(Math.round((stillAvailable / n) * 1000) / 10);
  }
  return out;
}

export type StrategyAggregate = {
  avgStartingPPG: number;
  positionCounts: Record<string, number>;
  sampleOpening: string[];
};

export function aggregateStrategyResults(
  results: RosterEntry[][],
  rosterPositions: string[]
): StrategyAggregate {
  let ppgSum = 0;
  const positionCounts: Record<string, number> = {};

  for (const roster of results) {
    const withPpg = roster.map((r) => ({
      position: r.position ?? "UNKNOWN",
      ppg: estimatePPG(r.position, r.rank),
    }));
    ppgSum += computeLineup(withPpg, rosterPositions);
    for (const r of roster) {
      const pos = r.position ?? "UNKNOWN";
      positionCounts[pos] = (positionCounts[pos] ?? 0) + 1;
    }
  }

  const n = Math.max(1, results.length);
  for (const pos of Object.keys(positionCounts)) {
    positionCounts[pos] = Math.round((positionCounts[pos] / n) * 10) / 10;
  }

  const sample = results[0] ?? [];
  const sampleOpening = sample
    .filter((r) => r.round <= 4)
    .sort((a, b) => a.round - b.round)
    .map((r) => `R${r.round}: ${r.position ?? "?"}`);

  return {
    avgStartingPPG: Math.round((ppgSum / n) * 10) / 10,
    positionCounts,
    sampleOpening,
  };
}
