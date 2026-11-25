// Stadium coordinates and roof type, keyed by the nflverse schedule stadium_id
// (the same id is in https://github.com/nflverse/nflverse-data schedules).
// roof: "dome" = fixed roof, weather never matters; "retractable" = usually
// closed in bad weather; "outdoors" = weather matters.

export type Roof = "dome" | "retractable" | "outdoors";
export type Stadium = { id: string; name: string; lat: number; lon: number; roof: Roof; tz: string; team?: string };

export const STADIUMS: Stadium[] = [
  { id: "ATL97", name: "Mercedes-Benz Stadium", lat: 33.7554, lon: -84.4008, roof: "retractable", tz: "America/New_York", team: "ATL" },
  { id: "BAL00", name: "M&T Bank Stadium", lat: 39.278, lon: -76.6227, roof: "outdoors", tz: "America/New_York", team: "BAL" },
  { id: "BOS00", name: "Gillette Stadium", lat: 42.0909, lon: -71.2643, roof: "outdoors", tz: "America/New_York", team: "NE" },
  { id: "BUF00", name: "Highmark Stadium", lat: 42.7738, lon: -78.787, roof: "outdoors", tz: "America/New_York", team: "BUF" },
  { id: "CAR00", name: "Bank of America Stadium", lat: 35.2258, lon: -80.8528, roof: "outdoors", tz: "America/New_York", team: "CAR" },
  { id: "CHI98", name: "Soldier Field", lat: 41.8623, lon: -87.6167, roof: "outdoors", tz: "America/Chicago", team: "CHI" },
  { id: "CIN00", name: "Paycor Stadium", lat: 39.0955, lon: -84.5161, roof: "outdoors", tz: "America/New_York", team: "CIN" },
  { id: "CLE00", name: "Huntington Bank Field", lat: 41.5061, lon: -81.6995, roof: "outdoors", tz: "America/New_York", team: "CLE" },
  { id: "DAL00", name: "AT&T Stadium", lat: 32.7473, lon: -97.0945, roof: "retractable", tz: "America/Chicago", team: "DAL" },
  { id: "DEN00", name: "Empower Field at Mile High", lat: 39.7439, lon: -105.0201, roof: "outdoors", tz: "America/Denver", team: "DEN" },
  { id: "DET00", name: "Ford Field", lat: 42.34, lon: -83.0456, roof: "dome", tz: "America/Detroit", team: "DET" },
  { id: "GNB00", name: "Lambeau Field", lat: 44.5013, lon: -88.0622, roof: "outdoors", tz: "America/Chicago", team: "GB" },
  { id: "HOU00", name: "NRG Stadium", lat: 29.6847, lon: -95.4107, roof: "retractable", tz: "America/Chicago", team: "HOU" },
  { id: "IND00", name: "Lucas Oil Stadium", lat: 39.7601, lon: -86.1639, roof: "retractable", tz: "America/Indiana/Indianapolis", team: "IND" },
  { id: "JAX00", name: "EverBank Stadium", lat: 30.3239, lon: -81.6373, roof: "outdoors", tz: "America/New_York", team: "JAX" },
  { id: "KAN00", name: "GEHA Field at Arrowhead Stadium", lat: 39.0489, lon: -94.4839, roof: "outdoors", tz: "America/Chicago", team: "KC" },
  { id: "LAX01", name: "SoFi Stadium", lat: 33.9535, lon: -118.3392, roof: "dome", tz: "America/Los_Angeles", team: "LA" },
  { id: "MIA00", name: "Hard Rock Stadium", lat: 25.958, lon: -80.2389, roof: "outdoors", tz: "America/New_York", team: "MIA" },
  { id: "MIN01", name: "U.S. Bank Stadium", lat: 44.9737, lon: -93.2581, roof: "dome", tz: "America/Chicago", team: "MIN" },
  { id: "NAS00", name: "Nissan Stadium", lat: 36.1665, lon: -86.7713, roof: "outdoors", tz: "America/Chicago", team: "TEN" },
  { id: "NOR00", name: "Caesars Superdome", lat: 29.9511, lon: -90.0812, roof: "dome", tz: "America/Chicago", team: "NO" },
  { id: "NYC01", name: "MetLife Stadium", lat: 40.8135, lon: -74.0745, roof: "outdoors", tz: "America/New_York", team: "NYG" },
  { id: "PHI00", name: "Lincoln Financial Field", lat: 39.9008, lon: -75.1675, roof: "outdoors", tz: "America/New_York", team: "PHI" },
  { id: "PHO00", name: "State Farm Stadium", lat: 33.5276, lon: -112.2626, roof: "retractable", tz: "America/Phoenix", team: "ARI" },
  { id: "PIT00", name: "Acrisure Stadium", lat: 40.4468, lon: -80.0158, roof: "outdoors", tz: "America/New_York", team: "PIT" },
  { id: "SEA00", name: "Lumen Field", lat: 47.5952, lon: -122.3316, roof: "outdoors", tz: "America/Los_Angeles", team: "SEA" },
  { id: "SFO01", name: "Levi's Stadium", lat: 37.403, lon: -121.97, roof: "outdoors", tz: "America/Los_Angeles", team: "SF" },
  { id: "TAM00", name: "Raymond James Stadium", lat: 27.9759, lon: -82.5033, roof: "outdoors", tz: "America/New_York", team: "TB" },
  { id: "VEG00", name: "Allegiant Stadium", lat: 36.0909, lon: -115.1833, roof: "dome", tz: "America/Los_Angeles", team: "LV" },
  { id: "WAS00", name: "Northwest Stadium", lat: 38.9077, lon: -76.8645, roof: "outdoors", tz: "America/New_York", team: "WAS" },
  // International / neutral sites
  { id: "LON00", name: "Wembley Stadium", lat: 51.556, lon: -0.2796, roof: "outdoors", tz: "Europe/London" },
  { id: "LON01", name: "Twickenham Stadium", lat: 51.456, lon: -0.3415, roof: "outdoors", tz: "Europe/London" },
  { id: "LON02", name: "Tottenham Hotspur Stadium", lat: 51.6043, lon: -0.0664, roof: "outdoors", tz: "Europe/London" },
  { id: "MUN00", name: "Allianz Arena", lat: 48.2188, lon: 11.6247, roof: "outdoors", tz: "Europe/Berlin" },
  { id: "MUN01", name: "FC Bayern Munich Stadium", lat: 48.2188, lon: 11.6247, roof: "outdoors", tz: "Europe/Berlin" },
  { id: "FRA00", name: "Deutsche Bank Park", lat: 50.0686, lon: 8.6455, roof: "retractable", tz: "Europe/Berlin" },
  { id: "BER00", name: "Olympiastadion Berlin", lat: 52.5147, lon: 13.2395, roof: "outdoors", tz: "Europe/Berlin" },
  { id: "MAD01", name: "Bernabeu", lat: 40.4531, lon: -3.6883, roof: "retractable", tz: "Europe/Madrid" },
  { id: "PAR00", name: "Stade de France", lat: 48.9245, lon: 2.3601, roof: "outdoors", tz: "Europe/Paris" },
  { id: "DUB00", name: "Croke Park", lat: 53.3607, lon: -6.2512, roof: "outdoors", tz: "Europe/Dublin" },
  { id: "MEX00", name: "Estadio Banorte", lat: 19.3029, lon: -99.1505, roof: "outdoors", tz: "America/Mexico_City" },
  { id: "SAO00", name: "Neo Quimica Arena", lat: -23.5453, lon: -46.4742, roof: "outdoors", tz: "America/Sao_Paulo" },
  { id: "RIO00", name: "Maracana Stadium", lat: -22.9121, lon: -43.2302, roof: "outdoors", tz: "America/Sao_Paulo" },
  { id: "MEL00", name: "Melbourne Cricket Ground", lat: -37.82, lon: 144.9834, roof: "outdoors", tz: "Australia/Melbourne" },
];

export function stadiumById(id: string | undefined): Stadium | undefined {
  return id ? STADIUMS.find((s) => s.id === id) : undefined;
}

export function homeStadium(teamAbbr: string): Stadium | undefined {
  // Jets share MetLife with the Giants.
  const t = teamAbbr === "NYJ" ? "NYG" : teamAbbr;
  return STADIUMS.find((s) => s.team === t);
}
