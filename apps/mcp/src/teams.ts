// One table to translate team names between sources:
// nflverse/Sleeper abbreviations, ESPN ids/abbreviations, and the full names
// The Odds API uses.

export type Team = { abbr: string; espnId: number; espnAbbr: string; name: string };

export const TEAMS: Team[] = [
  { abbr: "ARI", espnId: 22, espnAbbr: "ARI", name: "Arizona Cardinals" },
  { abbr: "ATL", espnId: 1, espnAbbr: "ATL", name: "Atlanta Falcons" },
  { abbr: "BAL", espnId: 33, espnAbbr: "BAL", name: "Baltimore Ravens" },
  { abbr: "BUF", espnId: 2, espnAbbr: "BUF", name: "Buffalo Bills" },
  { abbr: "CAR", espnId: 29, espnAbbr: "CAR", name: "Carolina Panthers" },
  { abbr: "CHI", espnId: 3, espnAbbr: "CHI", name: "Chicago Bears" },
  { abbr: "CIN", espnId: 4, espnAbbr: "CIN", name: "Cincinnati Bengals" },
  { abbr: "CLE", espnId: 5, espnAbbr: "CLE", name: "Cleveland Browns" },
  { abbr: "DAL", espnId: 6, espnAbbr: "DAL", name: "Dallas Cowboys" },
  { abbr: "DEN", espnId: 7, espnAbbr: "DEN", name: "Denver Broncos" },
  { abbr: "DET", espnId: 8, espnAbbr: "DET", name: "Detroit Lions" },
  { abbr: "GB", espnId: 9, espnAbbr: "GB", name: "Green Bay Packers" },
  { abbr: "HOU", espnId: 34, espnAbbr: "HOU", name: "Houston Texans" },
  { abbr: "IND", espnId: 11, espnAbbr: "IND", name: "Indianapolis Colts" },
  { abbr: "JAX", espnId: 30, espnAbbr: "JAX", name: "Jacksonville Jaguars" },
  { abbr: "KC", espnId: 12, espnAbbr: "KC", name: "Kansas City Chiefs" },
  { abbr: "LV", espnId: 13, espnAbbr: "LV", name: "Las Vegas Raiders" },
  { abbr: "LAC", espnId: 24, espnAbbr: "LAC", name: "Los Angeles Chargers" },
  { abbr: "LA", espnId: 14, espnAbbr: "LAR", name: "Los Angeles Rams" },
  { abbr: "MIA", espnId: 15, espnAbbr: "MIA", name: "Miami Dolphins" },
  { abbr: "MIN", espnId: 16, espnAbbr: "MIN", name: "Minnesota Vikings" },
  { abbr: "NE", espnId: 17, espnAbbr: "NE", name: "New England Patriots" },
  { abbr: "NO", espnId: 18, espnAbbr: "NO", name: "New Orleans Saints" },
  { abbr: "NYG", espnId: 19, espnAbbr: "NYG", name: "New York Giants" },
  { abbr: "NYJ", espnId: 20, espnAbbr: "NYJ", name: "New York Jets" },
  { abbr: "PHI", espnId: 21, espnAbbr: "PHI", name: "Philadelphia Eagles" },
  { abbr: "PIT", espnId: 23, espnAbbr: "PIT", name: "Pittsburgh Steelers" },
  { abbr: "SF", espnId: 25, espnAbbr: "SF", name: "San Francisco 49ers" },
  { abbr: "SEA", espnId: 26, espnAbbr: "SEA", name: "Seattle Seahawks" },
  { abbr: "TB", espnId: 27, espnAbbr: "TB", name: "Tampa Bay Buccaneers" },
  { abbr: "TEN", espnId: 10, espnAbbr: "TEN", name: "Tennessee Titans" },
  { abbr: "WAS", espnId: 28, espnAbbr: "WSH", name: "Washington Commanders" },
];

const ALIASES: Record<string, string> = { LAR: "LA", WSH: "WAS", JAC: "JAX", OAK: "LV", SD: "LAC", STL: "LA" };

/** Accepts "LAR", "la", "Rams", "Los Angeles Rams", "28" (ESPN id)... returns the team or null. */
export function findTeam(input: string | undefined | null): Team | null {
  if (!input) return null;
  const s = input.trim();
  const up = s.toUpperCase();
  const abbr = ALIASES[up] ?? up;
  const byAbbr = TEAMS.find((t) => t.abbr === abbr);
  if (byAbbr) return byAbbr;
  if (/^\d+$/.test(s)) return TEAMS.find((t) => t.espnId === Number(s)) ?? null;
  const low = s.toLowerCase();
  return (
    TEAMS.find((t) => t.name.toLowerCase() === low) ??
    TEAMS.find((t) => t.name.toLowerCase().endsWith(" " + low)) ??
    TEAMS.find((t) => t.name.toLowerCase().includes(low)) ??
    null
  );
}

export function requireTeam(input: string): Team {
  const t = findTeam(input);
  if (!t) throw new Error(`Unknown team "${input}". Use an abbreviation like KC, LAR, WAS or a name like "Chiefs".`);
  return t;
}
