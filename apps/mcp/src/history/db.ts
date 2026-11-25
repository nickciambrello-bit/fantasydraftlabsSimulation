// Local SQLite store for league history. Uses Node's built-in node:sqlite
// (Node 22.13+), so there is nothing native to compile.

import type { DatabaseSync as DatabaseSyncT } from "node:sqlite";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// Loaded via require so bundlers/test runners don't try to resolve "sqlite" as a package.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export function defaultDbPath() {
  return process.env.FANTASY_LABS_DB ?? join(homedir(), ".fantasy-labs", "league-history.sqlite");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS seasons (
  league_id TEXT PRIMARY KEY,
  root_league_id TEXT NOT NULL,      -- the newest league in the chain, used to group seasons
  season INTEGER NOT NULL,
  name TEXT,
  previous_league_id TEXT,
  status TEXT,
  total_rosters INTEGER,
  playoff_week_start INTEGER,
  waiver_budget INTEGER,
  synced_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS managers (
  league_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  roster_id INTEGER NOT NULL,
  user_id TEXT,
  display_name TEXT,
  team_name TEXT,
  wins INTEGER, losses INTEGER, ties INTEGER,
  points_for REAL, points_against REAL,
  faab_used INTEGER,
  final_place INTEGER,               -- from the playoff brackets, when known
  PRIMARY KEY (league_id, roster_id)
);
CREATE TABLE IF NOT EXISTS matchups (
  league_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER NOT NULL,
  roster_id INTEGER NOT NULL,
  matchup_id INTEGER,
  points REAL,
  opponent_roster_id INTEGER,
  opponent_points REAL,
  is_playoffs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (league_id, week, roster_id)
);
CREATE TABLE IF NOT EXISTS draft_picks (
  league_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  draft_id TEXT NOT NULL,
  draft_type TEXT,
  round INTEGER, pick_no INTEGER, draft_slot INTEGER,
  roster_id INTEGER,
  user_id TEXT,
  player_id TEXT,
  player_name TEXT,
  position TEXT,
  nfl_team TEXT,
  is_keeper INTEGER,
  auction_amount INTEGER,
  PRIMARY KEY (draft_id, pick_no)
);
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id TEXT PRIMARY KEY,
  league_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  week INTEGER,
  type TEXT,                         -- waiver | free_agent | trade | commissioner
  status TEXT,                       -- complete | failed
  created_at TEXT,
  creator_user_id TEXT,
  faab_bid INTEGER,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS transaction_rosters (
  transaction_id TEXT NOT NULL,
  roster_id INTEGER NOT NULL,
  PRIMARY KEY (transaction_id, roster_id)
);
CREATE TABLE IF NOT EXISTS transaction_moves (
  transaction_id TEXT NOT NULL,
  roster_id INTEGER NOT NULL,
  action TEXT NOT NULL,              -- add | drop
  player_id TEXT NOT NULL,
  player_name TEXT,
  position TEXT,
  PRIMARY KEY (transaction_id, action, player_id)
);
CREATE TABLE IF NOT EXISTS transaction_picks (
  transaction_id TEXT NOT NULL,
  pick_season TEXT, round INTEGER,
  original_roster_id INTEGER, from_roster_id INTEGER, to_roster_id INTEGER
);
CREATE TABLE IF NOT EXISTS transaction_faab (
  transaction_id TEXT NOT NULL,
  from_roster_id INTEGER, to_roster_id INTEGER, amount INTEGER
);
CREATE TABLE IF NOT EXISTS playoff_matches (
  league_id TEXT NOT NULL,
  season INTEGER NOT NULL,
  bracket TEXT NOT NULL,             -- winners | losers
  round INTEGER, match_id INTEGER,
  t1 INTEGER, t2 INTEGER, winner INTEGER, loser INTEGER,
  place INTEGER,                     -- set on placement games: winner takes this place, loser the next
  PRIMARY KEY (league_id, bracket, match_id)
);
CREATE TABLE IF NOT EXISTS players (
  player_id TEXT PRIMARY KEY,
  name TEXT, position TEXT, nfl_team TEXT
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE INDEX IF NOT EXISTS ix_tx_league ON transactions(league_id, week);
CREATE INDEX IF NOT EXISTS ix_moves_player ON transaction_moves(player_id);
CREATE INDEX IF NOT EXISTS ix_managers_user ON managers(user_id);

-- Convenience view: one row per transaction move with the manager behind it.
CREATE VIEW IF NOT EXISTS v_moves AS
SELECT t.season, t.week, t.type, t.status, t.faab_bid, t.created_at, t.transaction_id, t.league_id,
       m.action, m.player_id, m.player_name, m.position,
       mg.user_id, mg.display_name, mg.team_name
FROM transaction_moves m
JOIN transactions t ON t.transaction_id = m.transaction_id
LEFT JOIN managers mg ON mg.league_id = t.league_id AND mg.roster_id = m.roster_id;
`;

export function openDb(path = defaultDbPath(), opts: { readOnly?: boolean } = {}) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, { readOnly: opts.readOnly ?? false });
  if (!opts.readOnly) {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(SCHEMA);
  }
  return db;
}

export type Db = DatabaseSyncT;

export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
