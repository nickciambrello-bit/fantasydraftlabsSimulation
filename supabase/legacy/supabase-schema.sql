-- Fantasy Draft Labs — Phase 1 schema
-- Run this once in the Supabase dashboard: SQL Editor > New query > paste > Run

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  sleeper_league_id text not null,
  name text not null,
  season text not null,
  created_at timestamptz not null default now(),
  unique (user_id, sleeper_league_id)
);

-- Row Level Security: each user can only see/edit their own leagues.
alter table public.leagues enable row level security;

create policy "Users can view their own leagues"
  on public.leagues for select
  using (auth.uid() = user_id);

create policy "Users can insert their own leagues"
  on public.leagues for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own leagues"
  on public.leagues for update
  using (auth.uid() = user_id);

create policy "Users can delete their own leagues"
  on public.leagues for delete
  using (auth.uid() = user_id);
