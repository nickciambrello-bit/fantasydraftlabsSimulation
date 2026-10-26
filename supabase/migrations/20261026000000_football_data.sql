-- Football reference data shared by every league: players and their IDs on
-- each platform, NFL games with betting lines, weekly stat lines, snaps and
-- injury reports. Loaded by packages/data; public read, service-role write.

create table if not exists public.players (
  player_id        text primary key,        -- nflverse gsis_id, or 'DST_<team>' for team defenses
  name             text not null,
  position         text,
  position_group   text,
  team             text,                    -- nflverse team code (LA, not LAR)
  birth_date       date,
  rookie_season    int,
  status           text,                    -- nflverse roster status (ACT, RES, ...)
  headshot_url     text,
  sleeper_id       text unique,
  espn_id          text,
  yahoo_id         text,
  pfr_id           text,
  mfl_id           text,
  fantasypros_id   text,
  sleeper_status        text,              -- Active, Inactive, Injured Reserve, ...
  sleeper_injury_status text,              -- Questionable, Doubtful, Out, IR, ...
  sleeper_depth_order   int,
  updated_at       timestamptz not null default now()
);
create index if not exists players_pfr_id_idx on public.players (pfr_id);
create index if not exists players_team_pos_idx on public.players (team, position);

create table if not exists public.games (
  game_id         text primary key,         -- e.g. 2026_08_KC_LV
  season          int not null,
  game_type       text not null,            -- REG, WC, DIV, CON, SB
  week            int not null,
  gameday         date,
  gametime        text,
  away_team       text not null,
  home_team       text not null,
  away_score      int,
  home_score      int,
  spread_line     numeric,                  -- home team favored by this many points
  total_line      numeric,
  away_moneyline  int,
  home_moneyline  int,
  div_game        boolean,
  roof            text,
  surface         text,
  temp            int,
  wind            int,
  updated_at      timestamptz not null default now()
);
create index if not exists games_season_week_idx on public.games (season, week);

create table if not exists public.player_week_stats (
  player_id       text not null,
  season          int not null,
  season_type     text not null,            -- REG or POST
  week            int not null,
  game_id         text,
  team            text,
  opponent        text,
  position        text,
  completions     int, attempts int, passing_yards int, passing_tds int,
  passing_interceptions int, sacks_suffered int, passing_2pt_conversions int,
  carries         int, rushing_yards int, rushing_tds int, rushing_2pt_conversions int,
  targets         int, receptions int, receiving_yards int, receiving_tds int,
  receiving_air_yards int, receiving_2pt_conversions int,
  target_share    numeric, air_yards_share numeric,
  fumbles_lost    int,
  special_teams_tds int,
  fg_made         int, fg_att int, pat_made int, pat_att int,
  fantasy_points      numeric,              -- nflverse standard scoring, for sanity checks only
  fantasy_points_ppr  numeric,
  raw             jsonb not null default '{}'::jsonb,  -- every other nonzero stat, so any scoring system can be computed
  primary key (player_id, season, season_type, week)
);
create index if not exists pws_season_week_idx on public.player_week_stats (season, week);

create table if not exists public.snap_counts (
  game_id         text not null,
  pfr_player_id   text not null,
  player_id       text,                     -- resolved via players.pfr_id when known
  season          int not null,
  game_type       text not null,
  week            int not null,
  team            text,
  position        text,
  offense_snaps   int, offense_pct numeric,
  defense_snaps   int, defense_pct numeric,
  st_snaps        int, st_pct numeric,
  primary key (game_id, pfr_player_id)
);
create index if not exists snap_counts_player_idx on public.snap_counts (player_id, season, week);

create table if not exists public.injury_reports (
  player_id       text not null,
  season          int not null,
  game_type       text not null,
  week            int not null,
  team            text,
  report_status   text,                     -- Out, Doubtful, Questionable, or null
  report_primary_injury text,
  practice_status text,
  practice_primary_injury text,
  primary key (player_id, season, game_type, week)
);

create table if not exists public.ingest_runs (
  id              bigint generated always as identity primary key,
  source          text not null,
  detail          text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  rows_written    int,
  status          text not null default 'running',  -- running, ok, error
  error           text
);

-- Public NFL data: anyone may read; only the service role (which bypasses RLS) writes.
do $$
declare t text;
begin
  foreach t in array array['players','games','player_week_stats','snap_counts','injury_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Public read" on public.%I', t);
    execute format('create policy "Public read" on public.%I for select using (true)', t);
  end loop;
end $$;
alter table public.ingest_runs enable row level security;
