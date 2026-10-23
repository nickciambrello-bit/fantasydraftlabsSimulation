-- Fantasy Draft Labs — Keepers schema addition
-- Run this in Supabase SQL Editor (New query > paste > Run).

create table if not exists public.keepers (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  sleeper_user_id text,
  manager_name text not null,
  player_name text not null,
  player_position text,
  round int not null,
  created_at timestamptz not null default now()
);

alter table public.keepers enable row level security;

create policy "Users can view their own keepers"
  on public.keepers for select
  using (
    exists (
      select 1 from public.leagues
      where leagues.id = keepers.league_id
      and leagues.user_id = auth.uid()
    )
  );

create policy "Users can insert their own keepers"
  on public.keepers for insert
  with check (
    exists (
      select 1 from public.leagues
      where leagues.id = keepers.league_id
      and leagues.user_id = auth.uid()
    )
  );

create policy "Users can update their own keepers"
  on public.keepers for update
  using (
    exists (
      select 1 from public.leagues
      where leagues.id = keepers.league_id
      and leagues.user_id = auth.uid()
    )
  );

create policy "Users can delete their own keepers"
  on public.keepers for delete
  using (
    exists (
      select 1 from public.leagues
      where leagues.id = keepers.league_id
      and leagues.user_id = auth.uid()
    )
  );
