-- Fantasy Draft Labs — Phase 4 schema addition
-- Run this in Supabase SQL Editor (New query > paste > Run).

create table if not exists public.ranking_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  source_type text not null default 'upload', -- 'upload' | 'sleeper_default'
  created_at timestamptz not null default now()
);

create table if not exists public.ranking_entries (
  id uuid primary key default gen_random_uuid(),
  ranking_source_id uuid not null references public.ranking_sources (id) on delete cascade,
  rank int,
  adp numeric,
  player_name_raw text not null,
  player_name_clean text not null,
  position text,
  team text,
  bye_week int,
  sleeper_player_id text
);

alter table public.ranking_sources enable row level security;
alter table public.ranking_entries enable row level security;

-- ranking_sources: full CRUD for the owning user, including DELETE
-- (learned this the hard way in Phase 3 — without an explicit DELETE
-- policy, delete calls silently affect zero rows instead of erroring).
create policy "Users can view their own ranking sources"
  on public.ranking_sources for select
  using (auth.uid() = user_id);

create policy "Users can insert their own ranking sources"
  on public.ranking_sources for insert
  with check (auth.uid() = user_id);

create policy "Users can delete their own ranking sources"
  on public.ranking_sources for delete
  using (auth.uid() = user_id);

-- ranking_entries: ownership checked through the parent ranking_sources row.
create policy "Users can view their own ranking entries"
  on public.ranking_entries for select
  using (
    exists (
      select 1 from public.ranking_sources
      where ranking_sources.id = ranking_entries.ranking_source_id
      and ranking_sources.user_id = auth.uid()
    )
  );

create policy "Users can insert their own ranking entries"
  on public.ranking_entries for insert
  with check (
    exists (
      select 1 from public.ranking_sources
      where ranking_sources.id = ranking_entries.ranking_source_id
      and ranking_sources.user_id = auth.uid()
    )
  );

create policy "Users can delete their own ranking entries"
  on public.ranking_entries for delete
  using (
    exists (
      select 1 from public.ranking_sources
      where ranking_sources.id = ranking_entries.ranking_source_id
      and ranking_sources.user_id = auth.uid()
    )
  );
