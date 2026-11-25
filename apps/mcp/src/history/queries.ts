// Questions about league history, answered from the local SQLite store.

import type { Db } from "./db.js";

type R = Record<string, unknown>;
const all = (db: Db, sql: string, ...p: (string | number | null)[]) => db.prepare(sql).all(...p) as R[];
const one = (db: Db, sql: string, ...p: (string | number | null)[]) => db.prepare(sql).get(...p) as R | undefined;
const r1 = (n: unknown) => (n == null ? null : Math.round(Number(n) * 10) / 10);

export function syncStatus(db: Db) {
  const last = one(db, "SELECT value FROM meta WHERE key = 'last_sync'");
  const seasons = all(
    db,
    `SELECT s.season, s.league_id, s.name, s.status, s.synced_at,
            (SELECT COUNT(*) FROM transactions t WHERE t.league_id = s.league_id) AS transactions,
            (SELECT COUNT(*) FROM draft_picks d WHERE d.league_id = s.league_id) AS draft_picks,
            (SELECT MAX(week) FROM matchups m WHERE m.league_id = s.league_id) AS last_week_with_scores
     FROM seasons s ORDER BY s.season DESC`,
  );
  return { lastSync: last ? JSON.parse(String(last.value)) : null, seasons };
}

export type Manager = { user_id: string; display_name: string; team_names: string[] };

export function listManagers(db: Db): Manager[] {
  const rows = all(
    db,
    `SELECT user_id, display_name, team_name, season FROM managers WHERE user_id IS NOT NULL ORDER BY season DESC`,
  );
  const map = new Map<string, Manager>();
  for (const r of rows) {
    const id = String(r.user_id);
    const m = map.get(id) ?? { user_id: id, display_name: String(r.display_name ?? id), team_names: [] };
    if (r.team_name && !m.team_names.includes(String(r.team_name))) m.team_names.push(String(r.team_name));
    map.set(id, m);
  }
  return [...map.values()];
}

/** Match a manager by user id, display name or any team name they've used. */
export function resolveManager(db: Db, who: string): Manager {
  const ms = listManagers(db);
  const q = who.trim().toLowerCase();
  const exact = ms.filter(
    (m) => m.user_id === who || m.display_name.toLowerCase() === q || m.team_names.some((t) => t.toLowerCase() === q),
  );
  const hits = exact.length
    ? exact
    : ms.filter((m) => m.display_name.toLowerCase().includes(q) || m.team_names.some((t) => t.toLowerCase().includes(q)));
  if (hits.length === 1) return hits[0];
  const names = ms.map((m) => m.display_name).join(", ");
  if (!hits.length) throw new Error(`No manager matches "${who}". Managers: ${names}`);
  throw new Error(`"${who}" matches several managers: ${hits.map((h) => h.display_name).join(", ")}`);
}

const seasonClause = (season?: number) => (season ? ` AND mg.season = ${Number(season)}` : "");

export function managerTendencies(db: Db, args: { manager?: string; season?: number } = {}) {
  const managers = args.manager ? [resolveManager(db, args.manager)] : listManagers(db);
  const sc = seasonClause(args.season);
  const profiles = managers.map((m) => {
    const uid = m.user_id;
    const rec = one(
      db,
      `SELECT COUNT(*) seasons, SUM(wins) w, SUM(losses) l, SUM(ties) t, AVG(points_for) avg_pf,
              SUM(CASE WHEN final_place = 1 THEN 1 ELSE 0 END) titles,
              GROUP_CONCAT(CASE WHEN final_place IS NOT NULL THEN mg.season || ':' || final_place END) places
       FROM managers mg WHERE user_id = ?${sc}`,
      uid,
    );
    const playoffs = one(
      db,
      `SELECT COUNT(DISTINCT mg.league_id) n FROM managers mg
       JOIN playoff_matches p ON p.league_id = mg.league_id AND p.bracket = 'winners' AND (p.t1 = mg.roster_id OR p.t2 = mg.roster_id)
       WHERE mg.user_id = ?${sc}`,
      uid,
    );

    // FAAB: winning bids, as a share of each season's budget.
    const faab = one(
      db,
      `SELECT COUNT(*) wins, SUM(t.faab_bid) spent, AVG(t.faab_bid) avg_bid, MAX(t.faab_bid) max_bid,
              AVG(CASE WHEN s.waiver_budget > 0 THEN 100.0 * t.faab_bid / s.waiver_budget END) avg_bid_pct_budget,
              SUM(CASE WHEN s.waiver_budget > 0 AND t.faab_bid >= 0.2 * s.waiver_budget THEN 1 ELSE 0 END) big_bids,
              SUM(CASE WHEN t.week <= 4 THEN t.faab_bid ELSE 0 END) spent_weeks_1_4
       FROM transactions t
       JOIN transaction_rosters tr ON tr.transaction_id = t.transaction_id
       JOIN managers mg ON mg.league_id = t.league_id AND mg.roster_id = tr.roster_id
       JOIN seasons s ON s.league_id = t.league_id
       WHERE t.type = 'waiver' AND t.status = 'complete' AND mg.user_id = ?${sc}`,
      uid,
    );
    const failed = one(
      db,
      `SELECT COUNT(*) n FROM transactions t
       JOIN transaction_rosters tr ON tr.transaction_id = t.transaction_id
       JOIN managers mg ON mg.league_id = t.league_id AND mg.roster_id = tr.roster_id
       WHERE t.type = 'waiver' AND t.status = 'failed' AND mg.user_id = ?${sc}`,
      uid,
    );
    // Overpay: winning bid minus the best losing bid on the same player in the same week.
    const overpay = one(
      db,
      `WITH wins AS (
         SELECT t.league_id, t.week, mv.player_id, t.faab_bid bid
         FROM transactions t
         JOIN transaction_moves mv ON mv.transaction_id = t.transaction_id AND mv.action = 'add'
         JOIN managers mg ON mg.league_id = t.league_id AND mg.roster_id = mv.roster_id
         WHERE t.type = 'waiver' AND t.status = 'complete' AND mg.user_id = ?${sc}
       ), losers AS (
         SELECT t.league_id, t.week, mv.player_id, MAX(t.faab_bid) bid
         FROM transactions t JOIN transaction_moves mv ON mv.transaction_id = t.transaction_id AND mv.action = 'add'
         WHERE t.type = 'waiver' AND t.status = 'failed' GROUP BY 1, 2, 3
       )
       SELECT COUNT(*) contested, AVG(w.bid - l.bid) avg_margin, SUM(w.bid - l.bid) total_margin
       FROM wins w JOIN losers l USING (league_id, week, player_id)`,
      uid,
    );
    const fa = one(
      db,
      `SELECT COUNT(*) n FROM transactions t
       JOIN transaction_rosters tr ON tr.transaction_id = t.transaction_id
       JOIN managers mg ON mg.league_id = t.league_id AND mg.roster_id = tr.roster_id
       WHERE t.type = 'free_agent' AND t.status = 'complete' AND mg.user_id = ?${sc}`,
      uid,
    );

    // Drops: total, quick drops (added then dropped within 2 weeks), drops of their own early draft picks,
    // and drops a rival scooped up within 2 weeks.
    const drops = one(
      db,
      `WITH d AS (
         SELECT t.league_id, t.week, t.created_at, mv.player_id, mv.roster_id
         FROM transactions t JOIN transaction_moves mv ON mv.transaction_id = t.transaction_id AND mv.action = 'drop'
         JOIN managers mg ON mg.league_id = t.league_id AND mg.roster_id = mv.roster_id
         WHERE t.status = 'complete' AND t.type != 'trade' AND mg.user_id = ?${sc}
       )
       SELECT COUNT(*) total,
         SUM(EXISTS (SELECT 1 FROM transactions t2 JOIN transaction_moves a ON a.transaction_id = t2.transaction_id AND a.action = 'add'
                     WHERE t2.league_id = d.league_id AND t2.status = 'complete' AND a.player_id = d.player_id
                       AND a.roster_id = d.roster_id AND t2.week BETWEEN d.week - 2 AND d.week
                       AND t2.created_at < d.created_at)) quick_drops,
         SUM(EXISTS (SELECT 1 FROM draft_picks dp WHERE dp.league_id = d.league_id AND dp.player_id = d.player_id
                       AND dp.roster_id = d.roster_id AND dp.round <= 8)) early_pick_drops,
         SUM(EXISTS (SELECT 1 FROM transactions t3 JOIN transaction_moves a ON a.transaction_id = t3.transaction_id AND a.action = 'add'
                     WHERE t3.league_id = d.league_id AND t3.status = 'complete' AND a.player_id = d.player_id
                       AND a.roster_id != d.roster_id AND t3.week BETWEEN d.week AND d.week + 2)) scooped_by_rivals
       FROM d`,
      uid,
    );
    const earlyDrops = all(
      db,
      `SELECT dp.season, dp.round, dp.player_name, t.week dropped_week
       FROM transactions t JOIN transaction_moves mv ON mv.transaction_id = t.transaction_id AND mv.action = 'drop'
       JOIN draft_picks dp ON dp.league_id = t.league_id AND dp.player_id = mv.player_id AND dp.roster_id = mv.roster_id
       JOIN managers mg ON mg.league_id = t.league_id AND mg.roster_id = mv.roster_id
       WHERE t.status = 'complete' AND t.type != 'trade' AND dp.round <= 8 AND mg.user_id = ?${sc}
       ORDER BY dp.season DESC, dp.round LIMIT 8`,
      uid,
    );

    const trades = one(
      db,
      `SELECT COUNT(DISTINCT t.transaction_id) n FROM transactions t
       JOIN transaction_rosters tr ON tr.transaction_id = t.transaction_id
       JOIN managers mg ON mg.league_id = t.league_id AND mg.roster_id = tr.roster_id
       WHERE t.type = 'trade' AND t.status = 'complete' AND mg.user_id = ?${sc}`,
      uid,
    );
    const partners = all(
      db,
      `SELECT other.display_name partner, COUNT(DISTINCT t.transaction_id) trades
       FROM transactions t
       JOIN transaction_rosters me ON me.transaction_id = t.transaction_id
       JOIN managers mg ON mg.league_id = t.league_id AND mg.roster_id = me.roster_id
       JOIN transaction_rosters tr ON tr.transaction_id = t.transaction_id AND tr.roster_id != me.roster_id
       JOIN managers other ON other.league_id = t.league_id AND other.roster_id = tr.roster_id
       WHERE t.type = 'trade' AND t.status = 'complete' AND mg.user_id = ?${sc}
       GROUP BY other.user_id ORDER BY trades DESC LIMIT 3`,
      uid,
    );

    const draft = one(
      db,
      `WITH firsts AS (
         SELECT dp.league_id, dp.position, MIN(dp.round) rnd FROM draft_picks dp
         JOIN managers mg ON mg.league_id = dp.league_id AND mg.roster_id = dp.roster_id
         WHERE mg.user_id = ? AND dp.is_keeper = 0${sc} GROUP BY dp.league_id, dp.position
       )
       SELECT AVG(CASE WHEN position = 'QB' THEN rnd END) first_qb_round,
              AVG(CASE WHEN position = 'TE' THEN rnd END) first_te_round,
              AVG(CASE WHEN position IN ('K', 'DEF') THEN rnd END) first_k_def_round
       FROM firsts`,
      uid,
    );
    const early = all(
      db,
      `SELECT dp.position, COUNT(*) n FROM draft_picks dp
       JOIN managers mg ON mg.league_id = dp.league_id AND mg.roster_id = dp.roster_id
       WHERE mg.user_id = ? AND dp.round <= 4${sc} GROUP BY dp.position ORDER BY n DESC`,
      uid,
    );
    const earlyTotal = early.reduce((s, r) => s + Number(r.n), 0);
    const auction = one(
      db,
      `SELECT COUNT(*) n, MAX(auction_amount) max_price, AVG(auction_amount) avg_price FROM draft_picks dp
       JOIN managers mg ON mg.league_id = dp.league_id AND mg.roster_id = dp.roster_id
       WHERE mg.user_id = ? AND dp.auction_amount IS NOT NULL${sc}`,
      uid,
    );

    const faabWins = Number(faab?.wins ?? 0);
    const tendencies: string[] = [];
    if (Number(overpay?.contested) >= 3 && Number(overpay?.avg_margin) >= 5)
      tendencies.push(`overbids: wins contested claims by ${r1(overpay?.avg_margin)} FAAB on average`);
    if (Number(faab?.big_bids) >= 3) tendencies.push(`makes big FAAB swings (${faab?.big_bids} bids of 20%+ of budget)`);
    if (Number(faab?.spent) > 0 && Number(faab?.spent_weeks_1_4) / Number(faab?.spent) >= 0.5)
      tendencies.push("spends most FAAB in weeks 1-4");
    if (Number(drops?.early_pick_drops) >= 2) tendencies.push(`panic-drops early draft picks (${drops?.early_pick_drops} times)`);
    if (Number(drops?.quick_drops) >= 4) tendencies.push(`churns: ${drops?.quick_drops} players dropped within 2 weeks of adding`);
    if (Number(drops?.scooped_by_rivals) >= 4) tendencies.push(`${drops?.scooped_by_rivals} of their drops were picked up by rivals within 2 weeks`);
    if (Number(trades?.n) === 0) tendencies.push("never trades");
    else if (Number(trades?.n) >= Number(rec?.seasons ?? 1) * 3) tendencies.push("active trader");

    return {
      manager: m.display_name,
      user_id: uid,
      team_names: m.team_names,
      record: {
        seasons: rec?.seasons,
        wins: rec?.w,
        losses: rec?.l,
        ties: rec?.t,
        avg_points_for: r1(rec?.avg_pf),
        playoff_appearances: playoffs?.n,
        titles: rec?.titles,
        finishes: rec?.places ?? null,
      },
      faab: {
        claims_won: faabWins,
        claims_lost: failed?.n,
        total_spent: faab?.spent ?? 0,
        avg_winning_bid: r1(faab?.avg_bid),
        avg_bid_pct_of_budget: r1(faab?.avg_bid_pct_budget),
        max_bid: faab?.max_bid ?? null,
        contested_wins: overpay?.contested ?? 0,
        avg_overpay_vs_next_bid: r1(overpay?.avg_margin),
        share_spent_weeks_1_4_pct: Number(faab?.spent) ? r1((100 * Number(faab?.spent_weeks_1_4)) / Number(faab?.spent)) : null,
        free_agent_adds: fa?.n,
      },
      drops: {
        total: Number(drops?.total ?? 0),
        quick_drops: Number(drops?.quick_drops ?? 0),
        early_pick_drops: Number(drops?.early_pick_drops ?? 0),
        scooped_by_rivals: Number(drops?.scooped_by_rivals ?? 0),
        recent_early_pick_drops: earlyDrops,
      },
      trades: { total: trades?.n, top_partners: partners },
      draft: {
        avg_first_qb_round: r1(draft?.first_qb_round),
        avg_first_te_round: r1(draft?.first_te_round),
        avg_first_k_or_def_round: r1(draft?.first_k_def_round),
        rounds_1_4_position_mix: Object.fromEntries(early.map((r) => [r.position, `${Math.round((100 * Number(r.n)) / (earlyTotal || 1))}%`])),
        auction: Number(auction?.n) ? { picks: auction?.n, max_price: auction?.max_price, avg_price: r1(auction?.avg_price) } : undefined,
      },
      tendencies,
    };
  });
  return { ...syncStamp(db), managers: profiles };
}

function syncStamp(db: Db) {
  const last = one(db, "SELECT value FROM meta WHERE key = 'last_sync'");
  const parsed = last ? (JSON.parse(String(last.value)) as { syncedAt: string }) : null;
  return {
    dataSyncedAt: parsed?.syncedAt ?? null,
    note: parsed
      ? `League history as of ${parsed.syncedAt}. Run league_history_sync to pull new weeks.`
      : "No league history yet. Run league_history_sync first.",
  };
}

export function faabHistory(db: Db, args: { manager?: string; season?: number; minBid?: number; player?: string; includeFailed?: boolean; limit?: number }) {
  const where: string[] = ["t.type = 'waiver'"];
  const params: (string | number)[] = [];
  if (!args.includeFailed) where.push("t.status = 'complete'");
  if (args.manager) {
    where.push("mg.user_id = ?");
    params.push(resolveManager(db, args.manager).user_id);
  }
  if (args.season) {
    where.push("t.season = ?");
    params.push(args.season);
  }
  if (args.minBid != null) {
    where.push("t.faab_bid >= ?");
    params.push(args.minBid);
  }
  if (args.player) {
    where.push("mv.player_name LIKE ?");
    params.push(`%${args.player}%`);
  }
  const rows = all(
    db,
    `SELECT t.season, t.week, mg.display_name manager, mv.player_name player, mv.position, t.faab_bid bid, t.status,
            (SELECT GROUP_CONCAT(d.player_name) FROM transaction_moves d WHERE d.transaction_id = t.transaction_id AND d.action = 'drop') dropped,
            (SELECT MAX(t2.faab_bid) FROM transactions t2 JOIN transaction_moves m2 ON m2.transaction_id = t2.transaction_id AND m2.action = 'add'
              WHERE t2.league_id = t.league_id AND t2.week = t.week AND m2.player_id = mv.player_id AND t2.transaction_id != t.transaction_id) best_other_bid
     FROM transactions t
     JOIN transaction_moves mv ON mv.transaction_id = t.transaction_id AND mv.action = 'add'
     JOIN managers mg ON mg.league_id = t.league_id AND mg.roster_id = mv.roster_id
     WHERE ${where.join(" AND ")}
     ORDER BY t.season DESC, t.faab_bid DESC LIMIT ?`,
    ...params,
    args.limit ?? 50,
  );
  return { ...syncStamp(db), rows };
}

export function tradeHistory(db: Db, args: { manager?: string; season?: number; limit?: number }) {
  const params: (string | number)[] = [];
  let where = "t.type = 'trade' AND t.status = 'complete'";
  if (args.manager) {
    where += " AND t.transaction_id IN (SELECT tr.transaction_id FROM transaction_rosters tr JOIN transactions tt ON tt.transaction_id = tr.transaction_id JOIN managers mg ON mg.league_id = tt.league_id AND mg.roster_id = tr.roster_id WHERE mg.user_id = ?)";
    params.push(resolveManager(db, args.manager).user_id);
  }
  if (args.season) {
    where += " AND t.season = ?";
    params.push(args.season);
  }
  const trades = all(db, `SELECT * FROM transactions t WHERE ${where} ORDER BY t.created_at DESC LIMIT ?`, ...params, args.limit ?? 30);
  const name = db.prepare("SELECT display_name FROM managers WHERE league_id = ? AND roster_id = ?");
  const mgr = (league: unknown, roster: unknown) =>
    ((name.get(String(league), Number(roster)) as R | undefined)?.display_name as string) ?? `roster ${roster}`;
  return {
    ...syncStamp(db),
    trades: trades.map((t) => {
      const sides: Record<string, { received: string[] }> = {};
      const side = (r: unknown) => (sides[mgr(t.league_id, r)] ??= { received: [] });
      for (const r of all(db, "SELECT roster_id FROM transaction_rosters WHERE transaction_id = ?", String(t.transaction_id))) side(r.roster_id);
      for (const mv of all(db, "SELECT * FROM transaction_moves WHERE transaction_id = ? AND action = 'add'", String(t.transaction_id)))
        side(mv.roster_id).received.push(`${mv.player_name}${mv.position ? ` (${mv.position})` : ""}`);
      for (const p of all(db, "SELECT * FROM transaction_picks WHERE transaction_id = ?", String(t.transaction_id)))
        side(p.to_roster_id).received.push(`${p.pick_season} round ${p.round} pick (originally ${mgr(t.league_id, p.original_roster_id)})`);
      for (const f of all(db, "SELECT * FROM transaction_faab WHERE transaction_id = ?", String(t.transaction_id)))
        side(f.to_roster_id).received.push(`$${f.amount} FAAB`);
      return { season: t.season, week: t.week, date: t.created_at, sides };
    }),
  };
}

export function draftHistory(db: Db, args: { season?: number; manager?: string; maxRound?: number; position?: string }) {
  const where = ["1=1"];
  const params: (string | number)[] = [];
  if (args.season) {
    where.push("dp.season = ?");
    params.push(args.season);
  }
  if (args.manager) {
    where.push("mg.user_id = ?");
    params.push(resolveManager(db, args.manager).user_id);
  }
  if (args.maxRound) {
    where.push("dp.round <= ?");
    params.push(args.maxRound);
  }
  if (args.position) {
    where.push("dp.position = ?");
    params.push(args.position.toUpperCase());
  }
  const rows = all(
    db,
    `SELECT dp.season, dp.round, dp.pick_no, mg.display_name manager, dp.player_name player, dp.position, dp.nfl_team,
            dp.is_keeper, dp.auction_amount
     FROM draft_picks dp LEFT JOIN managers mg ON mg.league_id = dp.league_id AND mg.roster_id = dp.roster_id
     WHERE ${where.join(" AND ")} ORDER BY dp.season DESC, dp.pick_no LIMIT 400`,
    ...params,
  );
  return { ...syncStamp(db), rows };
}

export function headToHead(db: Db, args: { a: string; b: string }) {
  const A = resolveManager(db, args.a);
  const B = resolveManager(db, args.b);
  const games = all(
    db,
    `SELECT m.season, m.week, m.points a_points, m.opponent_points b_points, m.is_playoffs
     FROM matchups m
     JOIN managers ma ON ma.league_id = m.league_id AND ma.roster_id = m.roster_id
     JOIN managers mb ON mb.league_id = m.league_id AND mb.roster_id = m.opponent_roster_id
     WHERE ma.user_id = ? AND mb.user_id = ? AND m.points > 0
     ORDER BY m.season DESC, m.week DESC`,
    A.user_id,
    B.user_id,
  );
  const aw = games.filter((g) => Number(g.a_points) > Number(g.b_points)).length;
  const bw = games.filter((g) => Number(g.a_points) < Number(g.b_points)).length;
  return { ...syncStamp(db), a: A.display_name, b: B.display_name, record: `${aw}-${bw}${games.length - aw - bw ? `-${games.length - aw - bw}` : ""}`, games };
}

/** Read-only SQL for anything the tools above don't cover. */
export function runReadOnlySql(db: Db, sql: string, limit = 200) {
  const s = sql.trim().replace(/;+\s*$/, "");
  if (!/^(select|with)\b/i.test(s) || s.includes(";")) throw new Error("Only a single SELECT (or WITH ... SELECT) statement is allowed.");
  const rows = db.prepare(s).all() as R[];
  return { ...syncStamp(db), rowCount: rows.length, rows: rows.slice(0, limit), truncated: rows.length > limit };
}

export const SCHEMA_DOC = `Tables: seasons(league_id, season, name, status, playoff_week_start, waiver_budget, synced_at),
managers(league_id, season, roster_id, user_id, display_name, team_name, wins, losses, ties, points_for, points_against, faab_used, final_place),
matchups(league_id, season, week, roster_id, matchup_id, points, opponent_roster_id, opponent_points, is_playoffs),
draft_picks(league_id, season, draft_id, draft_type, round, pick_no, draft_slot, roster_id, user_id, player_id, player_name, position, nfl_team, is_keeper, auction_amount),
transactions(transaction_id, league_id, season, week, type[waiver|free_agent|trade|commissioner], status[complete|failed], created_at, creator_user_id, faab_bid, notes),
transaction_rosters(transaction_id, roster_id), transaction_moves(transaction_id, roster_id, action[add|drop], player_id, player_name, position),
transaction_picks(transaction_id, pick_season, round, original_roster_id, from_roster_id, to_roster_id), transaction_faab(transaction_id, from_roster_id, to_roster_id, amount),
playoff_matches(league_id, season, bracket[winners|losers], round, match_id, t1, t2, winner, loser, place), players(player_id, name, position, nfl_team).
View v_moves joins moves to transactions and managers. Join managers on (league_id, roster_id); user_id is stable across seasons.`;
