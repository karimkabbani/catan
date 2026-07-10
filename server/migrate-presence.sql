-- DB-backed lobby presence — run once on the Catan Supabase project.
-- "Who's online" used to ride the realtime WebSocket only; mobile browsers kill those sockets
-- silently, so different phones saw different rosters. Presence now follows the same proven
-- pattern as chat + game state: each client heartbeats a row (server-stamped time) and polls
-- the fresh set. Server-side ages make it immune to device clock skew. Idempotent.

create table if not exists public.lobby_presence (
  id         text primary key,          -- persistent player id
  name       text,
  avatar     text,
  pref       text,                      -- preferred seat color for the next game
  mode       text,                      -- idle | ready | playing | spectate
  ready_at   bigint not null default 0,
  table_code text,                      -- which table they're at (null = browsing)
  created    text,                      -- table code they created (hosting)
  target     int,                       -- host's chosen win target
  at         timestamptz not null default now()
);

grant usage on schema public to anon, authenticated;

-- heartbeat: upsert my row with a SERVER timestamp (clients never write `at` themselves)
create or replace function public.presence_beat(p jsonb)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if p is null or coalesce(p->>'id', '') = '' then return; end if;
  insert into lobby_presence (id, name, avatar, pref, mode, ready_at, table_code, created, target, at)
  values (
    p->>'id', left(p->>'name', 40), p->>'avatar', p->>'pref', left(p->>'mode', 12),
    coalesce((p->>'readyAt')::bigint, 0), p->>'table', p->>'created', (p->>'target')::int, now()
  )
  on conflict (id) do update set
    name = excluded.name, avatar = excluded.avatar, pref = excluded.pref, mode = excluded.mode,
    ready_at = excluded.ready_at, table_code = excluded.table_code, created = excluded.created,
    target = excluded.target, at = now();
end $$;

-- roster: everyone seen in the last 60s, with a server-computed age (skew-proof)
create or replace function public.presence_list()
  returns table (id text, name text, avatar text, pref text, mode text, ready_at bigint,
                 table_code text, created text, target int, age_s numeric)
  language sql security definer set search_path = public as $$
  select id, name, avatar, pref, mode, ready_at, table_code, created, target,
         extract(epoch from (now() - at)) as age_s
  from lobby_presence
  where at > now() - interval '5 minutes';   -- backgrounded phones stay visible as away, not vanished
$$;

revoke all on function public.presence_beat(jsonb) from public;
revoke all on function public.presence_list() from public;
grant execute on function public.presence_beat(jsonb) to anon, authenticated;
grant execute on function public.presence_list() to anon, authenticated;

-- fold stale presence rows into the existing housekeeping purge
create or replace function public.purge_stale_games()
  returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.games
    where phase = 'idle'
       or updated_at < now() - interval '6 hours';
  get diagnostics n = row_count;
  delete from public.lobby_presence where at < now() - interval '2 hours';
  return n;
end $$;

-- lobby chat (messages with code 'LOBBY') keeps 48h of history — folded into the same purge
-- (see the purge_stale_games body above; re-applied 2026-07-09 with the messages cleanup line)
