-- Fantasy Draft Labs — Phase 6 schema addition
-- Run this in Supabase SQL Editor (New query > paste > Run).

create table if not exists public.draft_plans (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  draft_slot int,
  ranking_source_id uuid references public.ranking_sources (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.draft_plan_rounds (
  id uuid primary key default gen_random_uuid(),
  draft_plan_id uuid not null references public.draft_plans (id) on delete cascade,
  round int not null,
  primary_target_name text,
  primary_target_position text,
  pivot_notes text,
  notes text,
  unique (draft_plan_id, round)
);

alter table public.draft_plans enable row level security;
alter table public.draft_plan_rounds enable row level security;

-- Full CRUD for the owning user on draft_plans, including UPDATE and DELETE
-- from the start this time — a missing policy silently no-ops instead of
-- erroring, which cost real debugging time back in Phase 3.
create policy "Users can view their own draft plans"
  on public.draft_plans for select
  using (auth.uid() = user_id);

create policy "Users can insert their own draft plans"
  on public.draft_plans for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own draft plans"
  on public.draft_plans for update
  using (auth.uid() = user_id);

create policy "Users can delete their own draft plans"
  on public.draft_plans for delete
  using (auth.uid() = user_id);

-- draft_plan_rounds: ownership checked through the parent draft_plans row.
create policy "Users can view their own draft plan rounds"
  on public.draft_plan_rounds for select
  using (
    exists (
      select 1 from public.draft_plans
      where draft_plans.id = draft_plan_rounds.draft_plan_id
      and draft_plans.user_id = auth.uid()
    )
  );

create policy "Users can insert their own draft plan rounds"
  on public.draft_plan_rounds for insert
  with check (
    exists (
      select 1 from public.draft_plans
      where draft_plans.id = draft_plan_rounds.draft_plan_id
      and draft_plans.user_id = auth.uid()
    )
  );

create policy "Users can update their own draft plan rounds"
  on public.draft_plan_rounds for update
  using (
    exists (
      select 1 from public.draft_plans
      where draft_plans.id = draft_plan_rounds.draft_plan_id
      and draft_plans.user_id = auth.uid()
    )
  );

create policy "Users can delete their own draft plan rounds"
  on public.draft_plan_rounds for delete
  using (
    exists (
      select 1 from public.draft_plans
      where draft_plans.id = draft_plan_rounds.draft_plan_id
      and draft_plans.user_id = auth.uid()
    )
  );
