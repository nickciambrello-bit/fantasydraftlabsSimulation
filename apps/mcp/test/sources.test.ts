import { describe, expect, it } from "vitest";
import { parseCsv } from "../src/csv.js";
import { summarizeEvent, type OddsEvent } from "../src/sources/odds.js";
import { impactOf, summarizeWindow } from "../src/sources/weather.js";
import { parseDepthChart, parseInjuries, parseNews } from "../src/sources/espn.js";
import { currentWeek, personnelGroup, type Game } from "../src/sources/nflverse.js";
import { findTeam } from "../src/teams.js";
import { STADIUMS } from "../src/sources/stadiums.js";

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

describe("csv", () => {
  it("handles quotes, escaped quotes and CRLF", () => {
    const rows = parseCsv('a,b,c\r\n1,"x, y",3\r\n2,"say ""hi""",\r\n');
    expect(rows).toEqual([
      { a: "1", b: "x, y", c: "3" },
      { a: "2", b: 'say "hi"', c: "" },
    ]);
  });
});

describe("teams", () => {
  it("maps across sources", () => {
    expect(findTeam("LAR")?.abbr).toBe("LA");
    expect(findTeam("WSH")?.abbr).toBe("WAS");
    expect(findTeam("Kansas City Chiefs")?.abbr).toBe("KC");
    expect(findTeam("packers")?.abbr).toBe("GB");
    expect(findTeam("12")?.abbr).toBe("KC");
    expect(findTeam("nope")).toBeNull();
  });
  it("every team has a home stadium", () => {
    for (const t of ["ARI", "ATL", "BAL", "BUF", "CAR", "CHI", "CIN", "CLE", "DAL", "DEN", "DET", "GB", "HOU", "IND", "JAX", "KC", "LV", "LAC", "LA", "MIA", "MIN", "NE", "NO", "NYG", "PHI", "PIT", "SF", "SEA", "TB", "TEN", "WAS"]) {
      if (t === "LAC") continue; // shares SoFi (LAX01) with the Rams
      expect(STADIUMS.some((s) => s.team === t), t).toBe(true);
    }
  });
});

describe("odds", () => {
  const ev: OddsEvent = {
    id: "1",
    commence_time: "2026-11-30T18:00:00Z",
    home_team: "Detroit Lions",
    away_team: "Chicago Bears",
    bookmakers: [-3, -3.5, -2.5].map((pt, i) => ({
      key: `b${i}`,
      title: `B${i}`,
      last_update: "2026-11-29T10:00:00Z",
      markets: [
        { key: "spreads" as const, last_update: "2026-11-29T10:00:00Z", outcomes: [{ name: "Detroit Lions", price: -110, point: pt }, { name: "Chicago Bears", price: -110, point: -pt }] },
        { key: "totals" as const, last_update: "2026-11-29T10:00:00Z", outcomes: [{ name: "Over", price: -110, point: 50 + i }, { name: "Under", price: -110, point: 50 + i }] },
      ],
    })),
  };
  it("takes the median line and computes implied totals", () => {
    const l = summarizeEvent(ev);
    expect(l.favorite).toBe("DET");
    expect(l.spread).toBe(3);
    expect(l.total).toBe(51);
    expect(l.implied_points).toEqual({ DET: 27, CHI: 24 });
    expect(l.books).toBe(3);
  });
});

describe("weather", () => {
  it("summarizes the kickoff window and flags wind", () => {
    const h = {
      time: ["t0", "t1", "t2", "t3", "t4"],
      temperature_2m: [40, 38, 36, 34, 30],
      apparent_temperature: [32, 30, 28, 26, 20],
      precipitation_probability: [10, 20, 70, 30, 0],
      precipitation: [0, 0, 0.2, 0.1, 0],
      snowfall: [0, 0, 0, 0, 0],
      wind_speed_10m: [12, 18, 22, 16, 5],
      wind_gusts_10m: [20, 28, 34, 25, 8],
    };
    const f = summarizeWindow(h, 0);
    expect(f).toMatchObject({ temp_f: 37, wind_mph: 22, gusts_mph: 34, precip_chance_pct: 70, precip_in: 0.3 });
    expect(impactOf(f)).toContain("high wind");
    expect(impactOf(f)).toContain("rain likely");
    expect(impactOf({ ...f, wind_mph: 5, gusts_mph: 8, precip_chance_pct: 0, precip_in: 0 })).toBe("no meaningful weather impact");
  });
});

describe("espn parsers", () => {
  it("date-filters injuries and keeps fantasy positions", () => {
    const data = {
      injuries: [
        {
          id: "12",
          displayName: "Kansas City Chiefs",
          injuries: [
            { status: "Questionable", date: iso(1), shortComment: "Limited Wednesday", athlete: { displayName: "Rashee Rice", position: { abbreviation: "WR" } }, details: { type: "Knee" } },
            { status: "Injured Reserve", date: iso(60), athlete: { displayName: "Old Guy", position: { abbreviation: "RB" } } },
            { status: "Out", date: iso(2), athlete: { displayName: "Big Lineman", position: { abbreviation: "G" } } },
          ],
        },
        { id: "2", displayName: "Buffalo Bills", injuries: [{ status: "Out", date: iso(1), athlete: { displayName: "Bills WR", position: { abbreviation: "WR" } } }] },
      ],
    };
    const rows = parseInjuries(data, { team: "KC", positions: ["QB", "RB", "WR", "TE"] });
    expect(rows.map((r) => r.player)).toEqual(["Rashee Rice"]);
    expect(rows[0]).toMatchObject({ team: "KC", status: "Questionable", injury: "Knee" });
    // A player lookup ignores the age filter.
    expect(parseInjuries(data, { player: "old guy" })).toHaveLength(1);
  });

  it("drops stale news", () => {
    const data = {
      articles: [
        { headline: "Fresh", published: iso(0.5), categories: [{ type: "athlete", description: "Puka Nacua" }, { type: "team", teamId: 14 }] },
        { headline: "Last season", published: iso(300) },
      ],
    };
    const a = parseNews(data, {});
    expect(a.map((x) => x.headline)).toEqual(["Fresh"]);
    expect(a[0].teams).toEqual(["LA"]);
    expect(parseNews(data, { player: "nacua" })).toHaveLength(1);
    expect(parseNews(data, { player: "nobody" })).toHaveLength(0);
  });

  it("reads depth charts", () => {
    const d = parseDepthChart({
      depthchart: [
        {
          name: "3WR 1TE",
          positions: {
            qb: { position: { abbreviation: "QB" }, athletes: [{ displayName: "A" }, { displayName: "B" }] },
            wr: { position: { abbreviation: "WR" }, athletes: [{ displayName: "W1" }] },
            lt: { position: { abbreviation: "LT" }, athletes: [{ displayName: "OL" }] },
          },
        },
      ],
    });
    expect(d).toEqual({ QB: ["A", "B"], WR: ["W1"] });
  });
});

describe("nflverse helpers", () => {
  it("converts personnel to standard groupings", () => {
    expect(personnelGroup("1 C, 2 G, 1 QB, 1 RB, 2 T, 1 TE, 3 WR")).toBe("11");
    expect(personnelGroup("1 C, 1 FB, 2 G, 1 QB, 1 RB, 2 T, 1 TE, 2 WR")).toBe("21");
    expect(personnelGroup("1 RB, 2 TE, 2 WR")).toBe("12");
  });
  it("finds the current week from the schedule", () => {
    const g = (week: number, gameday: string, played: boolean) =>
      ({ season: 2026, week, gameday, home_score: played ? 20 : null }) as unknown as Game;
    const games = [g(11, "2026-11-16", true), g(12, "2026-11-26", false), g(13, "2026-12-03", false)];
    expect(currentWeek(games, new Date("2026-11-25T12:00:00Z"))).toEqual({ season: 2026, week: 12 });
  });
});
