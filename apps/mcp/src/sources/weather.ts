// Open-Meteo (https://open-meteo.com): free, no key, hourly forecasts up to 16 days.
// Joins this week's schedule to the stadium table and returns kickoff-window
// weather for every outdoor game.

import { fetchJson } from "../http.js";
import { findTeam } from "../teams.js";
import { gamesForWeek, type Game, type Opts } from "./nflverse.js";
import { homeStadium, stadiumById, type Stadium } from "./stadiums.js";

type Hourly = {
  time: string[];
  temperature_2m: number[];
  apparent_temperature: number[];
  precipitation_probability: number[];
  precipitation: number[];
  snowfall: number[];
  wind_speed_10m: number[];
  wind_gusts_10m: number[];
};

export type GameWeather = {
  game: string;
  kickoff_et: string;
  stadium: string;
  roof: string;
  forecast?: {
    temp_f: number;
    feels_like_f: number;
    wind_mph: number;
    gusts_mph: number;
    precip_chance_pct: number;
    precip_in: number;
    snow_in: number;
  };
  impact: string;
  note?: string;
};

/** Summarize the 4 hours from kickoff. */
export function summarizeWindow(h: Hourly, startIdx: number) {
  const idx = [0, 1, 2, 3].map((i) => startIdx + i).filter((i) => i < h.time.length);
  const max = (a: number[]) => Math.round(Math.max(...idx.map((i) => a[i] ?? 0)) * 10) / 10;
  const sum = (a: number[]) => Math.round(idx.reduce((s, i) => s + (a[i] ?? 0), 0) * 100) / 100;
  const avg = (a: number[]) => Math.round(idx.reduce((s, i) => s + (a[i] ?? 0), 0) / idx.length);
  return {
    temp_f: avg(h.temperature_2m),
    feels_like_f: avg(h.apparent_temperature),
    wind_mph: max(h.wind_speed_10m),
    gusts_mph: max(h.wind_gusts_10m),
    precip_chance_pct: max(h.precipitation_probability),
    precip_in: sum(h.precipitation),
    snow_in: sum(h.snowfall),
  };
}

export function impactOf(f: NonNullable<GameWeather["forecast"]>): string {
  const flags: string[] = [];
  if (f.wind_mph >= 20 || f.gusts_mph >= 30) flags.push("high wind: downgrade passing and kickers, lean unders");
  else if (f.wind_mph >= 15) flags.push("breezy: small downgrade to deep passing and long FGs");
  if (f.snow_in >= 0.5) flags.push("snow: slows passing, more rushing");
  else if (f.precip_chance_pct >= 60 && f.precip_in >= 0.1) flags.push("rain likely: ball security, slight downgrade to passing");
  if (f.feels_like_f <= 15) flags.push("extreme cold");
  return flags.length ? flags.join("; ") : "no meaningful weather impact";
}

function stadiumFor(g: Game): Stadium | undefined {
  return stadiumById(g.stadium_id) ?? homeStadium(findTeam(g.home_team)?.abbr ?? g.home_team);
}

/** Kickoff is listed in ET; find the matching hour index in a forecast that was requested in ET. */
function kickoffIndex(h: Hourly, g: Game) {
  const target = `${g.gameday}T${g.gametime.slice(0, 2)}:00`;
  return h.time.indexOf(target);
}

export async function gameWeather(args: { team?: string; season?: number; week?: number }, opts: Opts = {}) {
  const wk = await gamesForWeek(args.season, args.week, opts);
  const team = args.team ? findTeam(args.team) : null;
  if (args.team && !team) throw new Error(`Unknown team "${args.team}"`);
  const games = wk.games.filter((g) => !team || g.home_team === team.abbr || g.away_team === team.abbr);

  const results: GameWeather[] = await Promise.all(
    games.map(async (g): Promise<GameWeather> => {
      const st = stadiumFor(g);
      const base = {
        game: `${g.away_team} @ ${g.home_team}`,
        kickoff_et: `${g.gameday} ${g.gametime}`,
        stadium: st?.name ?? g.stadium,
        roof: st?.roof ?? g.roof ?? "unknown",
      };
      if (!st) return { ...base, impact: "unknown", note: `No coordinates for stadium ${g.stadium_id}` };
      if (st.roof === "dome") return { ...base, impact: "indoors: no weather impact" };
      const daysOut = (Date.parse(g.gameday) - Date.now()) / 86_400_000;
      if (daysOut > 15) return { ...base, impact: "unknown", note: "More than 16 days out; forecast not available yet." };
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${st.lat}&longitude=${st.lon}` +
        `&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,snowfall,wind_speed_10m,wind_gusts_10m` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=America%2FNew_York` +
        `&start_date=${g.gameday}&end_date=${nextDay(g.gameday)}`;
      try {
        const { data } = await fetchJson<{ hourly: Hourly }>(url);
        const i = kickoffIndex(data.hourly, g);
        if (i < 0) return { ...base, impact: "unknown", note: "Kickoff hour not in forecast" };
        const forecast = summarizeWindow(data.hourly, i);
        const impact =
          st.roof === "retractable"
            ? `retractable roof (usually closed in bad weather); outside: ${impactOf(forecast)}`
            : impactOf(forecast);
        return { ...base, forecast, impact };
      } catch (e) {
        return { ...base, impact: "unknown", note: `Forecast failed: ${(e as Error).message}` };
      }
    }),
  );
  const order = (r: GameWeather) => (r.roof === "outdoors" ? 0 : r.roof === "retractable" ? 1 : 2);
  results.sort((a, b) => order(a) - order(b) || (b.forecast?.wind_mph ?? 0) - (a.forecast?.wind_mph ?? 0));
  return {
    source: "Open-Meteo forecast API + nflverse schedule",
    fetchedAt: new Date().toISOString(),
    season: wk.season,
    week: wk.week,
    note: "Forecast covers the 4 hours from kickoff. Wind is the biggest fantasy factor: 15+ mph hurts deep passing and kickers.",
    games: results,
  };
}

function nextDay(d: string) {
  const t = new Date(d + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}
