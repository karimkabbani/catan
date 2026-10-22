-- APPLIED 2026-10-22 (by Karim in the Supabase SQL editor; used from v162). Lets guests see the host's
-- "Who starts" choice in the lobby. Run once on the Catan Supabase project. Idempotent.
-- The host's choice (rock-paper-scissors or random) rides presence like the win target does, so
-- everyone at the table sees it before the game starts. Purely additive: older clients never send
-- `ws` (stored as null) and simply ignore the extra column in the roster.

alter table public.lobby_presence add column if not exists ws text;   -- 'rps' | 'random' (host's pick)

create or replace function public.presence_beat(p jsonb)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if p is null or coalesce(p->>'id', '') = '' then return; end if;
  insert into lobby_presence (id, name, avatar, pref, mode, ready_at, table_code, created, target, ws, at)
  values (
    p->>'id', left(p->>'name', 40), p->>'avatar', p->>'pref', left(p->>'mode', 12),
    coalesce((p->>'readyAt')::bigint, 0), p->>'table', p->>'created', (p->>'target')::int, left(p->>'ws', 8), now()
  )
  on conflict (id) do update set
    name = excluded.name, avatar = excluded.avatar, pref = excluded.pref, mode = excluded.mode,
    ready_at = excluded.ready_at, table_code = excluded.table_code, created = excluded.created,
    target = excluded.target, ws = excluded.ws, at = now();
end $$;

-- the roster gains the column; a changed return type needs drop + create
drop function if exists public.presence_list();
create function public.presence_list()
  returns table (id text, name text, avatar text, pref text, mode text, ready_at bigint,
                 table_code text, created text, target int, ws text, age_s numeric)
  language sql security definer set search_path = public as $$
  select id, name, avatar, pref, mode, ready_at, table_code, created, target, ws,
         extract(epoch from (now() - at)) as age_s
  from lobby_presence
  where at > now() - interval '5 minutes';   -- backgrounded phones stay visible as away, not vanished
$$;

revoke all on function public.presence_beat(jsonb) from public;
revoke all on function public.presence_list() from public;
grant execute on function public.presence_beat(jsonb) to anon, authenticated;
grant execute on function public.presence_list() to anon, authenticated;
