import { describe, expect, it } from "vitest";
import { parseSeasons, currentSeason } from "../src/cli";
import { dedupeSleeperIds, indexIdMap, toGame, toPlayer, toWeekStats } from "../src/sources/nflverse";
import { resolveSleeperPlayers } from "../src/sources/sleeper";
import { teamFromSleeper } from "../src/teams";

describe("nflverse transforms", () => {
  it("merges the ID map into players and treats NA as null", () => {
    const ids = indexIdMap([{ gsis_id: "00-1", sleeper_id: "4046", yahoo_id: "NA", mfl_id: "123" }]);
    const p = toPlayer(
      { gsis_id: "00-1", display_name: "Patrick Mahomes", position: "QB", latest_team: "KC", espn_id: "3139477", pfr_id: "MahoPa00", birth_date: "1995-09-17", rookie_season: "2017" },
      ids
    );
    expect(p).toMatchObject({ player_id: "00-1", sleeper_id: "4046", yahoo_id: null, mfl_id: "123", rookie_season: 2017 });
    expect(toPlayer({ gsis_id: "NA", display_name: "x" }, ids)).toBeNull();
  });

  it("drops duplicate sleeper ids after the first", () => {
    const base = toPlayer({ gsis_id: "a", display_name: "A" }, new Map())!;
    const out = dedupeSleeperIds([
      { ...base, player_id: "a", sleeper_id: "1" },
      { ...base, player_id: "b", sleeper_id: "1" },
    ]);
    expect(out.map((p) => p.sleeper_id)).toEqual(["1", null]);
  });

  it("parses games with lines", () => {
    const g = toGame({ game_id: "2026_08_KC_LV", season: "2026", game_type: "REG", week: "8", away_team: "KC", home_team: "LV", spread_line: "-6.5", total_line: "47.5", div_game: "1", away_score: "NA" });
    expect(g).toMatchObject({ season: 2026, week: 8, spread_line: -6.5, total_line: 47.5, div_game: true, away_score: null });
  });

  it("keeps typed stats and only nonzero extras in raw", () => {
    const s = toWeekStats({
      player_id: "00-1", season: "2026", week: "3", season_type: "REG", team: "KC", opponent_team: "LV",
      passing_yards: "301", passing_tds: "3", carries: "0", passing_40: "2", headshot_url: "http://x", fumbles_lost_total: "1",
    })!;
    expect(s).toMatchObject({ passing_yards: 301, passing_tds: 3, carries: 0, fumbles_lost: 1, opponent: "LV" });
    expect(s.raw).toEqual({ passing_yards: 301, passing_tds: 3, passing_40: 2, fumbles_lost_total: 1 });
  });
});

describe("sleeper resolution", () => {
  const existingIds = new Set(["00-1", "00-2", "DST_LA"]);
  const bySleeper = new Map([["4046", "00-1"]]);

  it("matches by sleeper id, then gsis id, then creates SL_ placeholders", () => {
    const out = resolveSleeperPlayers(
      {
        "4046": { player_id: "4046", full_name: "Patrick Mahomes", position: "QB", team: "KC", injury_status: null },
        "9999": { player_id: "9999", full_name: "By Gsis", position: "WR", team: "LAR", gsis_id: " 00-2" },
        "7777": { player_id: "7777", full_name: "New Guy", position: "RB", team: "NYJ" },
        "LAR": { player_id: "LAR", first_name: "Los Angeles", last_name: "Rams", position: "DEF", team: "LAR" },
        "5555": { player_id: "5555", full_name: "Retired", position: "RB", team: null, status: "Inactive" },
        "6666": { player_id: "6666", full_name: "Lineman", position: "OL", team: "KC" },
      },
      bySleeper,
      existingIds
    );
    const byId = Object.fromEntries(out.map((u) => [u.player_id, u]));
    expect(Object.keys(byId).sort()).toEqual(["00-1", "00-2", "DST_LA", "SL_7777"]);
    expect(byId["00-2"]).toMatchObject({ team: "LA", isNew: false, sleeper_id: "9999" });
    expect(byId["SL_7777"].isNew).toBe(true);
    expect(byId["DST_LA"]).toMatchObject({ name: "Los Angeles Rams", team: "LA", sleeper_id: "LAR", isNew: false });
  });

  it("maps Sleeper team codes to nflverse", () => {
    expect(teamFromSleeper("LAR")).toBe("LA");
    expect(teamFromSleeper("KC")).toBe("KC");
    expect(teamFromSleeper(null)).toBeNull();
  });
});

describe("cli seasons", () => {
  it("parses ranges and lists", () => {
    expect(parseSeasons("2018-2020,2026")).toEqual([2018, 2019, 2020, 2026]);
    expect(() => parseSeasons("abc")).toThrow();
  });

  it("defaults to the current NFL season", () => {
    expect(currentSeason(new Date("2026-10-26"))).toBe(2026);
    expect(currentSeason(new Date("2027-01-15"))).toBe(2026);
    expect(parseSeasons(undefined, new Date("2026-10-26"))).toEqual([2026]);
  });
});
