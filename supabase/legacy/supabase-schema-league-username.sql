-- Fantasy Draft Labs — store the Sleeper username on the league
-- so draft-slot detection never needs to ask for it again.
-- Run this in Supabase SQL Editor.

alter table public.leagues
  add column if not exists sleeper_username text;
