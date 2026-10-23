-- Fantasy Draft Labs — mid-draft trade recording for Live Draft Room
-- Run this in Supabase SQL Editor.

alter table public.draft_sessions
  add column if not exists manual_trade_overrides jsonb not null default '[]'::jsonb;
