import { describe, expect, it } from "vitest";
import {
  buildPickOrder,
  createRng,
  pickForManager,
  shuffle,
  simulateFullDraftTracking,
  simulateNextPickOutlook,
  simulateStrategy,
  type ManagerProfile,
  type RankingRow,
} from "../src";

const POSITIONS = ["RB", "WR", "WR", "RB", "QB", "TE", "WR", "RB", "K", "DEF"];

function makeRankings(n: number): RankingRow[] {
  return Array.from({ length: n }, (_, i) => ({
    rank: i + 1,
    name: `Player ${i + 1}`,
    position: POSITIONS[i % POSITIONS.length],
    sleeper_player_id: null,
  }));
}

function makeProfiles(n: number): ManagerProfile[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `m${i}`,
    name: `Manager ${i}`,
    early: { RB: i % 3, WR: 2 },
    mid: { WR: 1, TE: i % 2 },
    late: { QB: 1, K: 1, DEF: 1 },
    keeper_rounds: [],
  }));
}

describe("rng", () => {
  it("is reproducible for the same seed and differs across seeds", () => {
    const a = createRng(42), b = createRng(42), c = createRng(43);
    const seqA = Array.from({ length: 5 }, () => a.next());
    const seqB = Array.from({ length: 5 }, () => b.next());
    const seqC = Array.from({ length: 5 }, () => c.next());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it("accepts string seeds", () => {
    expect(createRng("sim-abc").next()).toBe(createRng("sim-abc").next());
  });

  it("produces roughly uniform values in [0, 1)", () => {
    const rng = createRng(7);
    let sum = 0, min = 1, max = 0;
    const n = 100_000;
    for (let i = 0; i < n; i++) {
      const v = rng.next();
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    expect(sum / n).toBeCloseTo(0.5, 2);
  });

  it("shuffle keeps every element and is seed-stable", () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const s1 = shuffle(items, createRng(1));
    expect([...s1].sort((x, y) => x - y)).toEqual(items);
    expect(shuffle(items, createRng(1))).toEqual(s1);
    expect(items[0]).toBe(0); // input untouched
  });
});

describe("draft engines", () => {
  const rankings = makeRankings(200);
  const profiles = makeProfiles(11);

  it("builds a snake pick order", () => {
    expect(buildPickOrder(3, 2, "snake")).toEqual([1, 2, 3, 3, 2, 1]);
    expect(buildPickOrder(3, 2, "linear")).toEqual([1, 2, 3, 1, 2, 3]);
  });

  it("pickForManager only picks from the top of the board", () => {
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) {
      const pick = pickForManager(rankings, profiles[0], 1, {}, rng);
      expect(pick.rank).toBeLessThanOrEqual(40);
    }
  });

  it("simulateStrategy is deterministic with a seed", () => {
    const run = () =>
      simulateStrategy("zero_rb", rankings, profiles, 12, 15, "snake", 5, null, [], 20, createRng(99));
    const a = run();
    expect(a).toHaveLength(20);
    expect(a).toEqual(run());
    // Zero RB: no RBs in rounds 1-4 for the user.
    for (const roster of a) {
      expect(roster.filter((r) => r.round <= 4 && r.position === "RB")).toHaveLength(0);
    }
  });

  it("full draft tracking gives one pick per tracked player per sim", () => {
    const t = simulateFullDraftTracking(rankings, profiles, 12, 15, "snake", 1, null, [], 10, 50, createRng(5));
    expect(Object.keys(t.pickTracking)).toHaveLength(50);
    for (const picks of Object.values(t.pickTracking)) expect(picks).toHaveLength(10);
    // The #1 player must be gone by pick 12 in every sim.
    expect(t.pickTracking["Player 1"].every((p) => p <= 12)).toBe(true);
  });

  it("next-pick outlook is deterministic with a seed", () => {
    const order = buildPickOrder(12, 3, "snake");
    // User sits at seat 5 and is on the clock at overall pick 5.
    const remaining = order.slice(5).map((seat, i) => ({ round: Math.floor((i + 5) / 12) + 1, seat }));
    const run = () =>
      simulateNextPickOutlook(
        rankings[4],
        rankings.slice(4),
        remaining,
        (_round, seat) => profiles[seat % profiles.length],
        () => false,
        5,
        {},
        200,
        createRng(11)
      );
    const a = run();
    expect(a.picksUntilNext).toBe(14);
    expect(a.outlook.topAvailable.length).toBeGreaterThan(0);
    expect(a).toEqual(run());
  });
});
