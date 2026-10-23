-- Fantasy Draft Labs — Live Draft Room
-- Persistent draft sessions, unlike Mock Draft which is ephemeral/client-only.
-- A real draft can span hours, so state needs to survive reloads.
-- Run this in Supabase SQL Editor.

create table if not exists public.draft_sessions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  ranking_source_id uuid references public.ranking_sources (id) on delete set null,
  draft_plan_id uuid references public.draft_plans (id) on delete set null,
  draft_slot int not null,
  status text not null default 'in_progress', -- 'in_progress' | 'completed'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.draft_session_picks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.draft_sessions (id) on delete cascade,
  round int not null,
  overall_pick int not null,
  seat int not null,
  player_name text not null,
  position text,
  is_user_pick boolean not null default false,
  created_at timestamptz not null default now(),
  unique (session_id, overall_pick)
);

alter table public.draft_sessions enable row level security;
alter table public.draft_session_picks enable row level security;

-- All 4 policy types from the start on both tables.
create policy "Users can view their own draft sessions"
  on public.draft_sessions for select
  using (auth.uid() = user_id);

create policy "Users can insert their own draft sessions"
  on public.draft_sessions for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own draft sessions"
  on public.draft_sessions for update
  using (auth.uid() = user_id);

create policy "Users can delete their own draft sessions"
  on public.draft_sessions for delete
  using (auth.uid() = user_id);

create policy "Users can view their own draft session picks"
  on public.draft_session_picks for select
  using (
    exists (
      select 1 from public.draft_sessions
      where draft_sessions.id = draft_session_picks.session_id
      and draft_sessions.user_id = auth.uid()
    )
  );

create policy "Users can insert their own draft session picks"
  on public.draft_session_picks for insert
  with check (
    exists (
      select 1 from public.draft_sessions
      where draft_sessions.id = draft_session_picks.session_id
      and draft_sessions.user_id = auth.uid()
    )
  );

create policy "Users can update their own draft session picks"
  on public.draft_session_picks for update
  using (
    exists (
      select 1 from public.draft_sessions
      where draft_sessions.id = draft_session_picks.session_id
      and draft_sessions.user_id = auth.uid()
    )
  );

create policy "Users can delete their own draft session picks"
  on public.draft_session_picks for delete
  using (
    exists (
      select 1 from public.draft_sessions
      where draft_sessions.id = draft_session_picks.session_id
      and draft_sessions.user_id = auth.uid()
    )
  );
