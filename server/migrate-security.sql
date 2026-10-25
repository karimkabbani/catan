-- v201: security hardening (sweep batch D). Safe to run more than once. The app works before and after.
-- What it does:
--   1. the online list (lobby_presence) can only be changed through presence_beat (it was writable by anyone)
--   2. presence_beat caps the photo size it stores
--   3. PIN guessing is slowed down: 5 wrong PINs lock that name for 10 minutes
--   4. changing your PIN signs out every other device (new login token)
--   5. at most 60 players can be created
--   6. chat can no longer be wiped by anyone: only a finished game's own chat is cleared, through a function;
--      old game chat is cleaned up by the server (3h), the group chat after 48h as before
--   7. size caps on chat messages and on saved results, so nobody can stuff huge rows into them
-- Not changed (on purpose): game rows stay writable by the app (moves are written by the phones), and the
-- voice-note storage bucket keeps its rules. Locking those down needs a server that checks every move.

-- 1. online list: no direct access; presence_beat / presence_list (security definer) still work
alter table public.lobby_presence enable row level security;

-- 2. presence_beat: same as before, with the photo capped at 200 KB
create or replace function public.presence_beat(p jsonb)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if p is null or coalesce(p->>'id', '') = '' then return; end if;
  insert into lobby_presence (id, name, avatar, pref, mode, ready_at, table_code, created, target, ws, at)
  values (
    p->>'id', left(p->>'name', 40), case when char_length(p->>'avatar') <= 200000 then p->>'avatar' end, p->>'pref', left(p->>'mode', 12),
    coalesce((p->>'readyAt')::bigint, 0), p->>'table', p->>'created', (p->>'target')::int, left(p->>'ws', 8), now()
  )
  on conflict (id) do update set
    name = excluded.name, avatar = excluded.avatar, pref = excluded.pref, mode = excluded.mode,
    ready_at = excluded.ready_at, table_code = excluded.table_code, created = excluded.created,
    target = excluded.target, ws = excluded.ws, at = now();
end $$;

-- 3. PIN lockout
alter table public.players add column if not exists failed_logins int not null default 0;
alter table public.players add column if not exists locked_until timestamptz;

create or replace function public.player_login(p_name text, p_pin text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  select * into r from players where lower(name) = lower(trim(p_name));
  if not found then return json_build_object('ok', false, 'error', 'No such player'); end if;
  if r.locked_until is not null and r.locked_until > now() then
    return json_build_object('ok', false, 'error', 'Too many wrong PINs. Try again in a few minutes.');
  end if;
  if r.pin_hash <> crypt(p_pin, r.pin_hash) then
    update players set failed_logins = failed_logins + 1,
      locked_until = case when failed_logins + 1 >= 5 then now() + interval '10 minutes' else null end
      where id = r.id;
    return json_build_object('ok', false, 'error', 'Wrong PIN');
  end if;
  update players set last_seen = now(), failed_logins = 0, locked_until = null where id = r.id;
  return json_build_object('ok', true, 'id', r.id, 'name', r.name, 'token', r.token, 'avatar', r.avatar,
    'quick_msgs', r.quick_msgs, 'pref_color', r.pref_color, 'settings', r.settings);
end $$;

-- 4. a new PIN gets a new login token (the app saves the new one; other devices have to log in again)
create or replace function public.player_set_pin(p_token text, p_old text, p_new text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players; v_token text;
begin
  if char_length(p_new) < 4 then return json_build_object('ok', false, 'error', 'New PIN must be at least 4 digits'); end if;
  select * into r from players where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  if r.pin_hash <> crypt(p_old, r.pin_hash) then return json_build_object('ok', false, 'error', 'Wrong current PIN'); end if;
  v_token := replace(gen_random_uuid()::text, '-', '');
  update players set pin_hash = crypt(p_new, gen_salt('bf')), token = v_token, failed_logins = 0, locked_until = null where id = r.id;
  return json_build_object('ok', true, 'token', v_token);
end $$;

-- 5. at most 60 players
create or replace function public.player_create(p_name text, p_pin text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_token text;
begin
  p_name := trim(p_name);
  if p_name = '' or char_length(p_name) > 20 then return json_build_object('ok', false, 'error', 'Enter a name (max 20 chars)'); end if;
  if char_length(p_pin) < 4 then return json_build_object('ok', false, 'error', 'PIN must be at least 4 digits'); end if;
  if (select count(*) from players) >= 60 then return json_build_object('ok', false, 'error', 'The group is full'); end if;
  if exists (select 1 from players where lower(name) = lower(p_name)) then return json_build_object('ok', false, 'error', 'That name is taken'); end if;
  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into players(name, pin_hash, token) values (p_name, crypt(p_pin, gen_salt('bf')), v_token) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'name', p_name, 'token', v_token);
end $$;

-- 6. chat: no more delete-anything; a game's own chat is cleared through this function (never the group chat)
drop policy if exists messages_delete on public.messages;
create or replace function public.clear_game_chat(p_code text)
  returns void language sql security definer set search_path = public as $$
  delete from public.messages where code = p_code and code <> 'LOBBY';
$$;
revoke all on function public.clear_game_chat(text) from public;
grant execute on function public.clear_game_chat(text) to anon, authenticated;

create or replace function public.purge_stale_games()
  returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.games
    where phase = 'idle'
       or updated_at < now() - interval '6 hours';
  get diagnostics n = row_count;
  delete from public.lobby_presence where at < now() - interval '2 hours';
  delete from public.messages where code = 'LOBBY' and created_at < now() - interval '48 hours';
  delete from public.messages where code <> 'LOBBY' and created_at < now() - interval '3 hours';
  return n;
end $$;

-- 7. size caps (existing rows are not re-checked)
alter table public.messages drop constraint if exists messages_size;
alter table public.messages add constraint messages_size
  check (char_length(coalesce(body, '')) <= 2000 and char_length(coalesce(avatar, '')) <= 200000) not valid;
alter table public.game_results drop constraint if exists results_size;
alter table public.game_results add constraint results_size
  check (char_length(standings::text) <= 20000 and char_length(coalesce(final::text, '')) <= 400000) not valid;
