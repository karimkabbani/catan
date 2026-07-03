-- Finished-game results: one row per completed game, written by the client at game end.
-- Feeds the Stats screen (leaderboard, seasons, head-to-head, streaks). Non-sensitive, so
-- the browser (anon) can read + insert directly; a unique game_id dedups the multi-client
-- writes (every device that sees the game end tries to insert; only the first row lands).

create table if not exists public.game_results (
  id           uuid primary key default gen_random_uuid(),
  game_id      text unique,                -- engine state.id — dedups concurrent writes for one game
  code         text,                       -- join code, for reference
  player_count int  not null,
  -- standings ordered by finish (index 0 = winner): [{name,color,pts,place,lr,la}]
  standings    jsonb not null,
  finished_at  timestamptz not null default now()
);

create index if not exists game_results_finished_at on public.game_results (finished_at desc);

alter table public.game_results enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert on public.game_results to anon, authenticated;

drop policy if exists results_read   on public.game_results;
drop policy if exists results_insert on public.game_results;
create policy results_read   on public.game_results for select using (true);
create policy results_insert on public.game_results for insert with check (true);
