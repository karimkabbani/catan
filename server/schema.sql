-- Catan multiplayer — one row per game, kept in sync via Supabase Realtime.
-- The full engine GameState lives in `state` (jsonb, ~12KB). Clients subscribe to
-- row changes; the active player's browser writes the new state after each move.

create table if not exists public.games (
  code       text primary key,                               -- short join code, e.g. "K7Q2"
  phase      text not null default 'lobby',                  -- 'lobby' | 'playing' | 'ended'
  players    jsonb not null default '[]'::jsonb,             -- [{seat,color,name,clientId,connected}]
  state      jsonb,                                          -- engine GameState (null until started)
  host_id    text,                                           -- clientId of the host
  version    bigint not null default 0,                      -- optimistic concurrency guard
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Realtime needs the complete row on updates.
alter table public.games replica identity full;

-- Add the table to the realtime publication (ignore if already present).
do $$
begin
  begin
    alter publication supabase_realtime add table public.games;
  exception when duplicate_object then null;
  end;
end $$;

-- Friendly game: let the anon (browser) role read/create/update rows.
grant usage on schema public to anon, authenticated;
grant select, insert, update on public.games to anon, authenticated;

alter table public.games enable row level security;

drop policy if exists games_read   on public.games;
drop policy if exists games_create on public.games;
drop policy if exists games_update on public.games;
create policy games_read   on public.games for select using (true);
create policy games_create on public.games for insert with check (true);
create policy games_update on public.games for update using (true) with check (true);

-- Keep updated_at fresh.
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists games_touch on public.games;
create trigger games_touch before update on public.games
  for each row execute function public.touch_updated_at();

-- Tidy up abandoned games automatically would need pg_cron; skip for now.
