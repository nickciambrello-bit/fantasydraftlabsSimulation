-- Fantasy Draft Labs — Phase 3 schema addition
-- Run this in Supabase SQL Editor (New query > paste > Run).

create table if not exists public.league_history_seasons (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  sleeper_league_id text not null,
  season text not null,
  synced_at timestamptz not null default now(),
  unique (league_id, season)
);

create table if not exists public.draft_picks (
  id uuid primary key default gen_random_uuid(),
  history_season_id uuid not null references public.league_history_seasons (id) on delete cascade,
  round int not null,
  pick_no int not null,
  draft_slot int,
  roster_id int not null,
  sleeper_user_id text,
  manager_name text not null,
  player_id text,
  player_name text not null,
  player_position text,
  player_team text,
  is_keeper boolean not null default false
);

create table if not exists public.season_standings (
  id uuid primary key default gen_random_uuid(),
  history_season_id uuid not null references public.league_history_seasons (id) on delete cascade,
  roster_id int not null,
  sleeper_user_id text,
  manager_name text not null,
  wins int not null default 0,
  losses int not null default 0,
  ties int not null default 0,
  points_for numeric not null default 0,
  points_against numeric not null default 0,
  regular_season_rank int
);

alter table public.league_history_seasons enable row level security;
alter table public.draft_picks enable row level security;
alter table public.season_standings enable row level security;

create policy "Users can view their own league history"
  on public.league_history_seasons for select
  using (
    exists (
      select 1 from public.leagues
      where leagues.id = league_history_seasons.league_id
      and leagues.user_id = auth.uid()
    )
  );

create policy "Users can insert their own league history"
  on public.league_history_seasons for insert
  with check (
    exists (
      select 1 from public.leagues
      where leagues.id = league_history_seasons.league_id
      and leagues.user_id = auth.uid()
    )
  );

create policy "Users can view their own draft picks"
  on public.draft_picks for select
  using (
    exists (
      select 1 from public.league_history_seasons
      join public.leagues on leagues.id = league_history_seasons.league_id
      where league_history_seasons.id = draft_picks.history_season_id
      and leagues.user_id = auth.uid()
    )
  );

create policy "Users can insert their own draft picks"
  on public.draft_picks for insert
  with check (
    exists (
      select 1 from public.league_history_seasons
      join public.leagues on leagues.id = league_history_seasons.league_id
      where league_history_seasons.id = draft_picks.history_season_id
      and leagues.user_id = auth.uid()
    )
  );

create policy "Users can view their own standings"
  on public.season_standings for select
  using (
    exists (
      select 1 from public.league_history_seasons
      join public.leagues on leagues.id = league_history_seasons.league_id
      where league_history_seasons.id = season_standings.history_season_id
      and leagues.user_id = auth.uid()
    )
  );

create policy "Users can insert their own standings"
  on public.season_standings for insert
  with check (
    exists (
      select 1 from public.league_history_seasons
      join public.leagues on leagues.id = league_history_seasons.league_id
      where league_history_seasons.id = season_standings.history_season_id
      and leagues.user_id = auth.uid()
    )
  );
