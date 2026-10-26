// We store nflverse team codes everywhere. Sleeper differs only for the Rams.
const SLEEPER_TO_NFLVERSE: Record<string, string> = { LAR: "LA" };

export function teamFromSleeper(team: string | null | undefined): string | null {
  if (!team) return null;
  return SLEEPER_TO_NFLVERSE[team] ?? team;
}

export function dstPlayerId(nflverseTeam: string): string {
  return `DST_${nflverseTeam}`;
}
