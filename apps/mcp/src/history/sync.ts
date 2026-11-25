// Pull every season of a Sleeper league (following previous_league_id) into SQLite.

import { sleeper as defaultClient, type SleeperClient, type STransaction } from "../sources/sleeper.js";
import { tx, type Db } from "./db.js";

const PLAYERS_MAX_AGE_MS = 24 * 3600 * 1000; // Sleeper asks for /players/nfl at most once a day

export type SyncResult = {
  rootLeagueId: string;
  syncedAt: string;
  seasons: { season: number; league_id: string; status: string; skipped?: boolean; managers?: number; transactions?: number; picks?: number; matchups?: number }[];
};

export async function syncLeagueHistory(
  db: Db,
  leagueId: string,
  opts: { force?: boolean; client?: SleeperClient; maxSeasons?: number } = {},
): Promise<SyncResult> {
  const client = opts.client ?? defaultClient;
  const syncedAt = new Date().toISOString();
  await refreshPlayers(db, client);

  const result: SyncResult = { rootLeagueId: leagueId, syncedAt, seasons: [] };
  let id: string | null = leagueId;
  const seen = new Set<string>();
  while (id && id !== "0" && !seen.has(id) && result.seasons.length < (opts.maxSeasons ?? 30)) {
    seen.add(id);
    const league = await client.league(id);
    const season = Number(league.season);
    const existing = db.prepare("SELECT status FROM seasons WHERE league_id = ?").get(id) as { status: string } | undefined;
    // Finished seasons never change, so skip them unless asked. In-progress seasons always refresh.
    if (existing?.status === "complete" && league.status === "complete" && !opts.force) {
      result.seasons.push({ season, league_id: id, status: league.status, skipped: true });
      id = league.previous_league_id;
      continue;
    }
    const counts = await syncSeason(db, client, league, leagueId, syncedAt);
    result.seasons.push({ season, league_id: id, status: league.status, ...counts });
    id = league.previous_league_id;
  }
  db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('last_sync', ?)").run(JSON.stringify({ leagueId, syncedAt }));
  return result;
}

async function refreshPlayers(db: Db, client: SleeperClient) {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'players_synced_at'").get() as { value: string } | undefined;
  if (row && Date.now() - Date.parse(row.value) < PLAYERS_MAX_AGE_MS) return;
  const players = await client.players();
  const ins = db.prepare("INSERT OR REPLACE INTO players(player_id, name, position, nfl_team) VALUES (?, ?, ?, ?)");
  tx(db, () => {
    for (const [pid, p] of Object.entries(players)) {
      const name = p.full_name ?? [p.first_name, p.last_name].filter(Boolean).join(" ");
      ins.run(pid, name || pid, p.position ?? null, p.team ?? null);
    }
    db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('players_synced_at', ?)").run(new Date().toISOString());
  });
}

async function syncSeason(
  db: Db,
  client: SleeperClient,
  league: Awaited<ReturnType<SleeperClient["league"]>>,
  rootLeagueId: string,
  syncedAt: string,
) {
  const id = league.league_id;
  const season = Number(league.season);
  const playoffStart = Number(league.settings.playoff_week_start ?? 15) || 15;
  const lastWeek = Math.min(18, playoffStart + 3);
  const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1);

  const [users, rosters, drafts, winners, losers, matchupsByWeek, txByWeek] = await Promise.all([
    client.users(id),
    client.rosters(id),
    client.drafts(id),
    client.winnersBracket(id).catch(() => null),
    client.losersBracket(id).catch(() => null),
    Promise.all(weeks.map((w) => client.matchups(id, w).catch(() => []))),
    Promise.all(weeks.map((w) => client.transactions(id, w).catch(() => [] as STransaction[]))),
  ]);
  const picksByDraft = await Promise.all(drafts.map(async (d) => ({ d, picks: await client.picks(d.draft_id) })));

  const userById = new Map(users.map((u) => [u.user_id, u]));
  const rosterOwner = new Map(rosters.map((r) => [r.roster_id, r.owner_id]));
  const playerName = db.prepare("SELECT name, position FROM players WHERE player_id = ?");
  const lookup = (pid: string) => (playerName.get(pid) as { name: string; position: string } | undefined) ?? { name: pid, position: null };

  // Final places from the winners bracket placement games (p = 1 is the title game).
  const place = new Map<number, number>();
  for (const m of winners ?? []) {
    if (m.p && m.w && m.l) {
      place.set(m.w, m.p);
      place.set(m.l, m.p + 1);
    }
  }

  let txCount = 0;
  let pickCount = 0;
  let matchupCount = 0;

  tx(db, () => {
    for (const t of ["managers", "matchups", "draft_picks", "playoff_matches"]) {
      db.prepare(`DELETE FROM ${t} WHERE league_id = ?`).run(id);
    }
    for (const t of ["transaction_rosters", "transaction_moves", "transaction_picks", "transaction_faab"]) {
      db.prepare(`DELETE FROM ${t} WHERE transaction_id IN (SELECT transaction_id FROM transactions WHERE league_id = ?)`).run(id);
    }
    db.prepare("DELETE FROM transactions WHERE league_id = ?").run(id);

    db.prepare(
      `INSERT OR REPLACE INTO seasons(league_id, root_league_id, season, name, previous_league_id, status, total_rosters, playoff_week_start, waiver_budget, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, rootLeagueId, season, league.name, league.previous_league_id ?? null, league.status, league.total_rosters, playoffStart, Number(league.settings.waiver_budget ?? 0), syncedAt);

    const insMgr = db.prepare(
      `INSERT INTO managers(league_id, season, roster_id, user_id, display_name, team_name, wins, losses, ties, points_for, points_against, faab_used, final_place)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of rosters) {
      const u = r.owner_id ? userById.get(r.owner_id) : undefined;
      const s = r.settings ?? {};
      insMgr.run(
        id, season, r.roster_id, r.owner_id ?? null, u?.display_name ?? null, u?.metadata?.team_name ?? null,
        s.wins ?? 0, s.losses ?? 0, s.ties ?? 0,
        (s.fpts ?? 0) + (s.fpts_decimal ?? 0) / 100,
        (s.fpts_against ?? 0) + (s.fpts_against_decimal ?? 0) / 100,
        s.waiver_budget_used ?? null,
        place.get(r.roster_id) ?? null,
      );
    }

    const insMatch = db.prepare(
      `INSERT OR REPLACE INTO matchups(league_id, season, week, roster_id, matchup_id, points, opponent_roster_id, opponent_points, is_playoffs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    matchupsByWeek.forEach((rows, i) => {
      const week = i + 1;
      if (!rows?.length || rows.every((m) => !m.points)) return;
      for (const m of rows) {
        const opp = m.matchup_id == null ? undefined : rows.find((o) => o.matchup_id === m.matchup_id && o.roster_id !== m.roster_id);
        insMatch.run(id, season, week, m.roster_id, m.matchup_id ?? null, m.points ?? 0, opp?.roster_id ?? null, opp?.points ?? null, week >= playoffStart ? 1 : 0);
        matchupCount++;
      }
    });

    const insPick = db.prepare(
      `INSERT OR REPLACE INTO draft_picks(league_id, season, draft_id, draft_type, round, pick_no, draft_slot, roster_id, user_id, player_id, player_name, position, nfl_team, is_keeper, auction_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const { d, picks } of picksByDraft) {
      for (const p of picks) {
        const md = p.metadata ?? {};
        const name = [md.first_name, md.last_name].filter(Boolean).join(" ") || lookup(p.player_id).name;
        const rosterId = p.roster_id ?? null;
        insPick.run(
          id, season, d.draft_id, d.type, p.round, p.pick_no, p.draft_slot, rosterId,
          (rosterId != null ? rosterOwner.get(rosterId) : null) ?? p.picked_by ?? null,
          p.player_id, name, md.position ?? lookup(p.player_id).position, md.team ?? null,
          p.is_keeper ? 1 : 0, md.amount ? Number(md.amount) : null,
        );
        pickCount++;
      }
    }

    const insTx = db.prepare(
      `INSERT OR REPLACE INTO transactions(transaction_id, league_id, season, week, type, status, created_at, creator_user_id, faab_bid, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insRoster = db.prepare("INSERT OR IGNORE INTO transaction_rosters(transaction_id, roster_id) VALUES (?, ?)");
    const insMove = db.prepare(
      "INSERT OR REPLACE INTO transaction_moves(transaction_id, roster_id, action, player_id, player_name, position) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insTp = db.prepare(
      "INSERT INTO transaction_picks(transaction_id, pick_season, round, original_roster_id, from_roster_id, to_roster_id) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insFaab = db.prepare("INSERT INTO transaction_faab(transaction_id, from_roster_id, to_roster_id, amount) VALUES (?, ?, ?, ?)");
    const seenTx = new Set<string>();
    txByWeek.forEach((rows, i) => {
      for (const t of rows ?? []) {
        if (seenTx.has(t.transaction_id)) continue;
        seenTx.add(t.transaction_id);
        txCount++;
        insTx.run(
          t.transaction_id, id, season, t.leg ?? i + 1, t.type, t.status,
          t.created ? new Date(t.created).toISOString() : null, t.creator ?? null,
          t.type === "waiver" ? (t.settings?.waiver_bid ?? 0) : null, t.metadata?.notes ?? null,
        );
        for (const r of t.roster_ids ?? []) insRoster.run(t.transaction_id, r);
        for (const [pid, rid] of Object.entries(t.adds ?? {})) {
          const p = lookup(pid);
          insMove.run(t.transaction_id, rid, "add", pid, p.name, p.position);
        }
        for (const [pid, rid] of Object.entries(t.drops ?? {})) {
          const p = lookup(pid);
          insMove.run(t.transaction_id, rid, "drop", pid, p.name, p.position);
        }
        for (const dp of t.draft_picks ?? []) insTp.run(t.transaction_id, dp.season, dp.round, dp.roster_id, dp.previous_owner_id, dp.owner_id);
        for (const wb of t.waiver_budget ?? []) insFaab.run(t.transaction_id, wb.sender, wb.receiver, wb.amount);
      }
    });

    const insPo = db.prepare(
      "INSERT OR REPLACE INTO playoff_matches(league_id, season, bracket, round, match_id, t1, t2, winner, loser, place) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    for (const [name, rows] of [["winners", winners], ["losers", losers]] as const) {
      for (const m of rows ?? []) insPo.run(id, season, name, m.r, m.m, m.t1 ?? null, m.t2 ?? null, m.w ?? null, m.l ?? null, m.p ?? null);
    }
  });

  return { managers: rosters.length, transactions: txCount, picks: pickCount, matchups: matchupCount };
}
