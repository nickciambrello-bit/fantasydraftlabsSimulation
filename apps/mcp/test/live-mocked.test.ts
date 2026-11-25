// The Odds API and Open-Meteo end to end, with fetch mocked by URL.
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMemo } from "../src/http.js";
import { getOdds } from "../src/sources/odds.js";
import { gameWeather } from "../src/sources/weather.js";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const scheduleCsv = [
  "game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score,spread_line,total_line,roof,stadium_id,stadium,espn",
  `2026_12_KC_BUF,2026,REG,12,${day(1)},Sun,20:20,KC,,BUF,,3.5,47.5,outdoors,BUF00,Highmark Stadium,1`,
  `2026_12_CHI_DET,2026,REG,12,${day(1)},Sun,13:00,CHI,,DET,,-2.5,55.5,dome,DET00,Ford Field,2`,
].join("\n");

function mockFetch(routes: Record<string, (url: string) => Response>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const hit = Object.keys(routes).find((k) => url.includes(k));
    if (!hit) throw new Error(`unexpected ${url}`);
    return routes[hit](url);
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ODDS_API_KEY;
  clearMemo();
});

describe("game_weather", () => {
  it("forecasts outdoor games at kickoff and skips domes", async () => {
    const d = day(1);
    const hours = Array.from({ length: 48 }, (_, i) => `${i < 24 ? d : day(2)}T${String(i % 24).padStart(2, "0")}:00`);
    const calls = mockFetch({
      "schedules/games.csv": () => new Response(scheduleCsv),
      "api.open-meteo.com": () =>
        Response.json({
          hourly: {
            time: hours,
            temperature_2m: hours.map(() => 28),
            apparent_temperature: hours.map(() => 14),
            precipitation_probability: hours.map(() => 80),
            precipitation: hours.map(() => 0.05),
            snowfall: hours.map((_, i) => (i >= 20 && i <= 23 ? 0.3 : 0)),
            wind_speed_10m: hours.map((_, i) => (i === 21 ? 24 : 10)),
            wind_gusts_10m: hours.map(() => 20),
          },
        }),
    });
    const res = await gameWeather({});
    expect(res.week).toBe(12);
    const buf = res.games.find((g) => g.game === "KC @ BUF")!;
    expect(buf.forecast).toMatchObject({ temp_f: 28, wind_mph: 24, snow_in: 1.2 });
    expect(buf.impact).toMatch(/high wind/);
    expect(buf.impact).toMatch(/snow/);
    expect(buf.impact).toMatch(/extreme cold/);
    expect(res.games.find((g) => g.game === "CHI @ DET")!.impact).toMatch(/indoors/);
    expect(calls.filter((c) => c.includes("open-meteo"))).toHaveLength(1);
    expect(calls.find((c) => c.includes("open-meteo"))).toContain("latitude=42.7738");
  });
});

describe("game_lines", () => {
  it("uses The Odds API when a key is set and hides the key", async () => {
    process.env.ODDS_API_KEY = "secret123";
    const kickoff = new Date(Date.now() + 2 * 86_400_000).toISOString();
    mockFetch({
      "api.the-odds-api.com": () =>
        Response.json(
          [
            {
              id: "e1", commence_time: kickoff, home_team: "Buffalo Bills", away_team: "Kansas City Chiefs",
              bookmakers: [{ key: "dk", title: "DraftKings", last_update: kickoff, markets: [
                { key: "spreads", last_update: kickoff, outcomes: [{ name: "Buffalo Bills", price: -110, point: -3.5 }, { name: "Kansas City Chiefs", price: -110, point: 3.5 }] },
                { key: "totals", last_update: kickoff, outcomes: [{ name: "Over", price: -110, point: 47.5 }, { name: "Under", price: -110, point: 47.5 }] },
              ] }],
            },
          ],
          { headers: { "x-requests-remaining": "498", "x-requests-used": "2" } },
        ),
    });
    const res = await getOdds({ team: "Chiefs" });
    expect(res.source).not.toContain("secret123");
    expect(res.quota).toEqual({ remaining: "498", used: "2" });
    expect(res.games[0]).toMatchObject({ home: "BUF", away: "KC", favorite: "BUF", spread: 3.5, total: 47.5, implied_points: { BUF: 25.5, KC: 22 } });
  });

  it("falls back to nflverse lines with no key", async () => {
    mockFetch({ "schedules/games.csv": () => new Response(scheduleCsv) });
    const res = await getOdds({});
    expect(res.source).toMatch(/fallback/);
    expect(res.games.find((g) => g.home === "BUF")).toMatchObject({ favorite: "BUF", spread: 3.5, total: 47.5 });
  });
});
