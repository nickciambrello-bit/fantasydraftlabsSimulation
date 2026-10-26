import { fetchCsv } from "./csv";
import { recordRun, upsert, type Sql } from "./db";
import {
  NFLVERSE_URLS, dedupeBy, dedupeSleeperIds, indexIdMap,
  toGame, toInjury, toPlayer, toSnapCount, toWeekStats,
} from "./sources/nflverse";
import { SLEEPER_PLAYERS_URL, resolveSleeperPlayers, type SleeperPlayer } from "./sources/sleeper";

const log = (msg: string) => console.log(`[ingest] ${msg}`);

function notNull<T>(v: T | null): v is T {
  return v !== null;
}

/** Clear each sleeper_id from any row other than the one about to receive it. */
async function releaseSleeperIds(sql: Sql, sleeperIds: string[], playerIds: string[]): Promise<void> {
  if (sleeperIds.length === 0) return;
  await sql`
    update players p set sleeper_id = null
    from unnest(${sql.array(sleeperIds)}::text[], ${sql.array(playerIds)}::text[]) as m(sid, pid)
    where p.sleeper_id = m.sid and p.player_id <> m.pid`;
}

export async function ingestPlayers(sql: Sql): Promise<number> {
  return recordRun(sql, "nflverse", "players", async () => {
    const [players, idMap] = await Promise.all([
      fetchCsv(NFLVERSE_URLS.players),
      fetchCsv(NFLVERSE_URLS.idMap),
    ]);
    const ids = indexIdMap(idMap!);
    const rows = dedupeSleeperIds(dedupeBy(players!.map((r) => toPlayer(r, ids)).filter(notNull), (p) => p.player_id));
    // The ID map wins for any Sleeper id it knows: free that id from whatever
    // other row holds it (e.g. an SL_ placeholder) so the unique constraint holds.
    const linked = rows.filter((r) => r.sleeper_id);
    await releaseSleeperIds(sql, linked.map((r) => r.sleeper_id!), linked.map((r) => r.player_id));
    // Links the ID map lacks but the Sleeper loader found are kept.
    const n = await upsert(sql, "players", rows, ["player_id"], { keepExistingWhenNull: ["sleeper_id"] });
    log(`players: ${n}`);
    return n;
  });
}

export async function ingestSchedules(sql: Sql, seasons: number[]): Promise<number> {
  return recordRun(sql, "nflverse", "schedules", async () => {
    const all = await fetchCsv(NFLVERSE_URLS.schedules);
    const wanted = new Set(seasons);
    const rows = all!.map(toGame).filter(notNull).filter((g) => wanted.has(g.season));
    const n = await upsert(sql, "games", rows, ["game_id"]);
    log(`games: ${n}`);
    return n;
  });
}

export async function ingestWeeklyStats(sql: Sql, season: number): Promise<number> {
  return recordRun(sql, "nflverse", `weekly_stats ${season}`, async () => {
    const csv = await fetchCsv(NFLVERSE_URLS.weeklyStats(season), { optional: true });
    if (!csv) return 0;
    const rows = dedupeBy(csv.map(toWeekStats).filter(notNull), (r) => `${r.player_id}|${r.season_type}|${r.week}`);
    const n = await upsert(sql, "player_week_stats", rows, ["player_id", "season", "season_type", "week"]);
    log(`weekly stats ${season}: ${n}`);
    return n;
  });
}

export async function ingestSnapCounts(sql: Sql, season: number): Promise<number> {
  return recordRun(sql, "nflverse", `snap_counts ${season}`, async () => {
    const csv = await fetchCsv(NFLVERSE_URLS.snapCounts(season), { optional: true });
    if (!csv) return 0;
    const mapping = await sql<{ pfr_id: string; player_id: string }[]>`
      select pfr_id, player_id from players where pfr_id is not null`;
    const byPfr = new Map(mapping.map((m) => [m.pfr_id, m.player_id]));
    const rows = dedupeBy(csv.map((r) => toSnapCount(r, byPfr)).filter(notNull), (r) => `${r.game_id}|${r.pfr_player_id}`);
    const n = await upsert(sql, "snap_counts", rows, ["game_id", "pfr_player_id"]);
    log(`snap counts ${season}: ${n}`);
    return n;
  });
}

export async function ingestInjuries(sql: Sql, season: number): Promise<number> {
  return recordRun(sql, "nflverse", `injuries ${season}`, async () => {
    const csv = await fetchCsv(NFLVERSE_URLS.injuries(season), { optional: true });
    if (!csv) return 0;
    const rows = dedupeBy(csv.map(toInjury).filter(notNull), (r) => `${r.player_id}|${r.game_type}|${r.week}`);
    const n = await upsert(sql, "injury_reports", rows, ["player_id", "season", "game_type", "week"]);
    log(`injuries ${season}: ${n}`);
    return n;
  });
}

export async function ingestNflverse(sql: Sql, seasons: number[]): Promise<void> {
  await ingestPlayers(sql);
  await ingestSchedules(sql, seasons);
  for (const season of seasons) {
    await ingestWeeklyStats(sql, season);
    await ingestSnapCounts(sql, season);
    await ingestInjuries(sql, season);
  }
}

export async function ingestSleeperPlayers(sql: Sql, payload?: Record<string, SleeperPlayer>): Promise<number> {
  return recordRun(sql, "sleeper", "players", async () => {
    let players = payload;
    if (!players) {
      const res = await fetch(SLEEPER_PLAYERS_URL);
      if (!res.ok) throw new Error(`GET ${SLEEPER_PLAYERS_URL} failed: ${res.status}`);
      players = (await res.json()) as Record<string, SleeperPlayer>;
    }
    const existing = await sql<{ player_id: string; sleeper_id: string | null }[]>`
      select player_id, sleeper_id from players`;
    const bySleeper = new Map(existing.filter((e) => e.sleeper_id).map((e) => [e.sleeper_id!, e.player_id]));
    const ids = new Set(existing.map((e) => e.player_id));
    const updates = resolveSleeperPlayers(players, bySleeper, ids);

    // New rows get every column; existing rows only get Sleeper-owned columns,
    // so nflverse stays the source of truth for names, ids and bio data.
    const created = updates.filter((u) => u.isNew).map(({ isNew, ...u }) => u);
    const existingRows = updates.filter((u) => !u.isNew).map((u) => ({
      player_id: u.player_id,
      name: u.name,
      sleeper_id: u.sleeper_id,
      sleeper_status: u.sleeper_status,
      sleeper_injury_status: u.sleeper_injury_status,
      sleeper_depth_order: u.sleeper_depth_order,
    }));

    // Detach any sleeper_id we are about to assign elsewhere.
    await releaseSleeperIds(sql, updates.map((u) => u.sleeper_id), updates.map((u) => u.player_id));

    let n = await upsert(sql, "players", created, ["player_id"]);
    n += await upsert(sql, "players", existingRows, ["player_id"], {
      updateColumns: ["sleeper_id", "sleeper_status", "sleeper_injury_status", "sleeper_depth_order"],
    });
    log(`sleeper players: ${n} (${created.length} new)`);
    return n;
  });
}
