// Usage:
//   pnpm --filter @fantasy-labs/data ingest nflverse [--seasons 2018-2026]
//   pnpm --filter @fantasy-labs/data ingest sleeper
//   pnpm --filter @fantasy-labs/data ingest all [--seasons 2026]
// Requires DATABASE_URL.

import { connect } from "./db";
import { ingestNflverse, ingestSleeperPlayers } from "./ingest";

export function currentSeason(now = new Date()): number {
  // The NFL season is labelled by the year it starts; Jan-Feb belong to the prior season.
  return now.getUTCMonth() < 2 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
}

export function parseSeasons(arg: string | undefined, now = new Date()): number[] {
  if (!arg) return [currentSeason(now)];
  const out = new Set<number>();
  for (const part of arg.split(",")) {
    const [a, b] = part.split("-").map((s) => Number(s.trim()));
    if (!Number.isInteger(a) || (b !== undefined && !Number.isInteger(b))) throw new Error(`Bad --seasons value: ${arg}`);
    for (let y = a; y <= (b ?? a); y++) out.add(y);
  }
  return [...out].sort();
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const seasonsFlag = rest.indexOf("--seasons");
  const seasons = parseSeasons(seasonsFlag >= 0 ? rest[seasonsFlag + 1] : undefined);
  const sql = connect();
  try {
    if (command === "nflverse" || command === "all") await ingestNflverse(sql, seasons);
    if (command === "sleeper" || command === "all") await ingestSleeperPlayers(sql);
    if (!["nflverse", "sleeper", "all"].includes(command)) {
      console.error("Usage: ingest <nflverse|sleeper|all> [--seasons 2018-2026]");
      process.exitCode = 1;
    }
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
