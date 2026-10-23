-- Fantasy Draft Labs — Phase 2 schema addition
-- Run this in Supabase SQL Editor (New query > paste > Run).
-- Safe to run even though Phase 1's leagues table already exists.

create table if not exists public.league_settings (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade unique,
  scoring_type text not null,
  scoring_settings jsonb not null,
  roster_positions jsonb not null,
  league_size int not null,
  draft_type text,
  keeper_enabled boolean not null default false,
  keeper_count int not null default 0,
  keeper_cost_rule text not null default 'same_round',
  keeper_cost_adjustment int not null default 0,
  keeper_notes text,
  confirmed boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.league_settings enable row level security;

-- These policies check ownership through the parent leagues row,
-- since league_settings itself has no user_id column.
create policy "Users can view settings for their own leagues"
  on public.league_settings for select
  using (
    exists (
      select 1 from public.leagues
      where leagues.id = league_settings.league_id
      and leagues.user_id = auth.uid()
    )
  );

create policy "Users can insert settings for their own leagues"
  on public.league_settings for insert
  with check (
    exists (
      select 1 from public.leagues
      where leagues.id = league_settings.league_id
      and leagues.user_id = auth.uid()
    )
  );

create policy "Users can update settings for their own leagues"
  on public.league_settings for update
  using (
    exists (
      select 1 from public.leagues
      where leagues.id = league_settings.league_id
      and leagues.user_id = auth.uid()
    )
  );
