import { describe, expect, it, beforeAll } from "vitest";
import { openDb, type Db } from "../src/history/db.js";
import { syncLeagueHistory } from "../src/history/sync.js";
import { draftHistory, faabHistory, headToHead, managerTendencies, runReadOnlySql, syncStatus, tradeHistory } from "../src/history/queries.js";
import type { SleeperClient, STransaction } from "../src/sources/sleeper.js";

// Two seasons: L2025 (complete) -> L2026 (in season). Managers u1 (Nick), u2 (Rival), u3 (Third), u4 (Fourth).
const users = [
  { user_id: "u1", display_name: "Nickc71493", metadata: { team_name: "Number 1" } },
  { user_id: "u2", display_name: "Rival", metadata: { team_name: "FAAB Burner" } },
  { user_id: "u3", display_name: "Third", metadata: {} },
  { user_id: "u4", display_name: "Fourth", metadata: {} },
];
const rosters = (seed: number) =>
  users.map((u, i) => ({ roster_id: i + 1, owner_id: u.user_id, settings: { wins: 5 + ((i + seed) % 3), losses: 5, ties: 0, fpts: 1200 + i * 10, fpts_decimal: 50, fpts_against: 1100, waiver_budget_used: 40 } }));

const wv = (id: string, week: number, roster: number, player: string, bid: number, status = "complete", drop?: string): STransaction => ({
  transaction_id: id, type: "waiver", status, roster_ids: [roster], creator: "x", created: Date.UTC(2026, 8, week * 7), leg: week,
  adds: { [player]: roster }, drops: drop ? { [drop]: roster } : null, settings: { waiver_bid: bid },
});

const tx2026: Record<number, STransaction[]> = {
  2: [
    wv("w1", 2, 2, "p10", 60), wv("w1f", 2, 1, "p10", 20, "failed"), // Rival overbids by 40
    wv("w2", 2, 2, "p11", 30, "complete", "p1"), // Rival drops their round-1 pick
    wv("w2f", 2, 3, "p11", 5, "failed"),
  ],
  3: [
    wv("w3", 3, 2, "p12", 25), wv("w3f", 3, 4, "p12", 10, "failed"),
    wv("w4", 3, 2, "p13", 22, "complete", "p2"), wv("w4f", 3, 1, "p13", 2, "failed"),
    { transaction_id: "t1", type: "trade", status: "complete", roster_ids: [1, 3], creator: "u1", created: Date.UTC(2026, 9, 1), leg: 3,
      adds: { p20: 1, p21: 3 }, drops: { p20: 3, p21: 1 }, draft_picks: [{ season: "2027", round: 2, roster_id: 3, previous_owner_id: 3, owner_id: 1 }],
      waiver_budget: [{ sender: 1, receiver: 3, amount: 5 }] },
    { transaction_id: "f1", type: "free_agent", status: "complete", roster_ids: [3], creator: "u3", created: Date.UTC(2026, 9, 2), leg: 3,
      adds: { p1: 3 }, drops: null },
  ],
};

const picks = (seasonOffset: number) => [
  { round: 1, pick_no: 1, draft_slot: 1, roster_id: 2, picked_by: "u2", player_id: "p1", is_keeper: false, metadata: { first_name: "First", last_name: "Rounder", position: "RB", team: "KC" } },
  { round: 1, pick_no: 2, draft_slot: 2, roster_id: 1, picked_by: "u1", player_id: "p3", is_keeper: false, metadata: { first_name: "Nick", last_name: "Pick", position: seasonOffset ? "QB" : "WR", team: "BUF" } },
  { round: 2, pick_no: 3, draft_slot: 2, roster_id: 2, picked_by: "u2", player_id: "p2", is_keeper: false, metadata: { first_name: "Second", last_name: "Rounder", position: "WR", team: "DET" } },
];

function mockClient(): SleeperClient & { calls: string[] } {
  const calls: string[] = [];
  const leagues: Record<string, { season: string; status: string; prev: string | null }> = {
    L2026: { season: "2026", status: "in_season", prev: "L2025" },
    L2025: { season: "2025", status: "complete", prev: "0" },
  };
  const c = {
    calls,
    league: async (id: string) => {
      calls.push(`league ${id}`);
      const l = leagues[id];
      return { league_id: id, previous_league_id: l.prev, name: "JandO League", season: l.season, status: l.status, total_rosters: 4, settings: { playoff_week_start: 15, waiver_budget: 100 } };
    },
    users: async () => users,
    rosters: async (id: string) => rosters(id === "L2026" ? 0 : 1),
    matchups: async (id: string, week: number) =>
      week <= 2
        ? [
            { roster_id: 1, matchup_id: 1, points: 120 + week },
            { roster_id: 2, matchup_id: 1, points: 100 },
            { roster_id: 3, matchup_id: 2, points: 90 },
            { roster_id: 4, matchup_id: 2, points: 95 },
          ]
        : [],
    transactions: async (id: string, week: number) => (id === "L2026" ? (tx2026[week] ?? []) : []),
    drafts: async (id: string) => [{ draft_id: `D${id}`, type: "snake", status: "complete", season: leagues[id].season }],
    picks: async (draftId: string) => picks(draftId === "DL2026" ? 0 : 1),
    winnersBracket: async (id: string) =>
      id === "L2025" ? [{ r: 1, m: 1, t1: 1, t2: 2, w: 1, l: 2, p: 1 }, { r: 1, m: 2, t1: 3, t2: 4, w: 4, l: 3, p: 3 }] : [],
    losersBracket: async () => [],
    players: async () => {
      calls.push("players");
      return Object.fromEntries(["p1", "p2", "p3", "p10", "p11", "p12", "p13", "p20", "p21"].map((p) => [p, { full_name: `Player ${p}`, position: "WR", team: "KC" }]));
    },
    state: async () => ({ season: "2026", week: 12, season_type: "regular" }),
  };
  return c as unknown as SleeperClient & { calls: string[] };
}

let db: Db;
let client: ReturnType<typeof mockClient>;

beforeAll(async () => {
  db = openDb(":memory:");
  client = mockClient();
  const res = await syncLeagueHistory(db, "L2026", { client });
  expect(res.seasons.map((s) => s.season)).toEqual([2026, 2025]);
});

describe("league history", () => {
  it("stores every season with a sync timestamp", () => {
    const s = syncStatus(db);
    expect(s.seasons).toHaveLength(2);
    expect(s.seasons[0]).toMatchObject({ season: 2026, transactions: 10, draft_picks: 3, last_week_with_scores: 2 });
    expect(s.lastSync.syncedAt).toMatch(/^\d{4}-/);
  });

  it("re-sync refreshes the live season, skips finished ones, and fetches players at most daily", async () => {
    client.calls.length = 0;
    const res = await syncLeagueHistory(db, "L2026", { client });
    expect(res.seasons.find((s) => s.season === 2025)?.skipped).toBe(true);
    expect(res.seasons.find((s) => s.season === 2026)?.skipped).toBeUndefined();
    expect(client.calls).not.toContain("players");
    expect(syncStatus(db).seasons[0].transactions).toBe(10); // no duplicates
  });

  it("profiles FAAB overbidding and panic drops", () => {
    const { managers } = managerTendencies(db, { manager: "FAAB Burner" });
    const r = managers[0];
    expect(r.manager).toBe("Rival");
    expect(r.faab).toMatchObject({ claims_won: 4, total_spent: 137, max_bid: 60, contested_wins: 4 });
    // margins: 40, 25, 15, 20 => 25
    expect(r.faab.avg_overpay_vs_next_bid).toBe(25);
    expect(r.drops.early_pick_drops).toBe(2);
    expect(r.tendencies.join(" ")).toMatch(/overbids/);
    expect(r.tendencies.join(" ")).toMatch(/panic-drops/);
  });

  it("tracks titles, playoffs and draft habits", () => {
    const nick = managerTendencies(db, { manager: "nickc" }).managers[0];
    expect(nick.record).toMatchObject({ seasons: 2, titles: 1, playoff_appearances: 1 });
    expect(nick.draft.avg_first_qb_round).toBe(1);
    expect(nick.trades.total).toBe(1);
    expect(nick.trades.top_partners[0]).toMatchObject({ partner: "Third", trades: 1 });
  });

  it("lists FAAB bids with the best competing bid", () => {
    const { rows } = faabHistory(db, { minBid: 50 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ manager: "Rival", bid: 60, best_other_bid: 20 });
  });

  it("shows both sides of a trade", () => {
    const { trades } = tradeHistory(db, { manager: "Third" });
    expect(trades).toHaveLength(1);
    const sides = trades[0].sides;
    expect(sides["Nickc71493"].received).toEqual(expect.arrayContaining(["Player p20 (WR)", expect.stringMatching(/2027 round 2/)]));
    expect(sides["Third"].received).toEqual(expect.arrayContaining(["Player p21 (WR)", "$5 FAAB"]));
  });

  it("answers draft and head-to-head questions", () => {
    expect(draftHistory(db, { season: 2026, maxRound: 1 }).rows).toHaveLength(2);
    const h = headToHead(db, { a: "Nickc71493", b: "Rival" });
    expect(h.record).toBe("4-0");
  });

  it("only allows read-only SQL", () => {
    expect(runReadOnlySql(db, "SELECT COUNT(*) n FROM transactions").rows[0]).toEqual({ n: 10 });
    expect(() => runReadOnlySql(db, "DELETE FROM transactions")).toThrow();
    expect(() => runReadOnlySql(db, "SELECT 1; DROP TABLE seasons")).toThrow();
  });
});
