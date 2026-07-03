-- Stale-game housekeeping. The `games` table accumulates rows: empty 'idle' lobbies left
-- after a game resets, and 'playing'/'ended' games that were abandoned (tab closed, never
-- finished). This SECURITY DEFINER function purges them; the client calls it (throttled) on
-- lobby entry, so cleanup happens automatically whenever anyone opens the app.
--
-- Safe thresholds: idle rows are empty (no state) so they go immediately; any other row not
-- touched in 6 hours is abandoned (a live game bumps updated_at on every move via the touch
-- trigger, and no session lasts 6h). Finished results are already saved in game_results.

create or replace function public.purge_stale_games()
  returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.games
    where phase = 'idle'
       or updated_at < now() - interval '6 hours';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.purge_stale_games() from public;
grant execute on function public.purge_stale_games() to anon, authenticated;
