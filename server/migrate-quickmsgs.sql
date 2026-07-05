-- Quick-messages migration — run once on the Catan Supabase project.
-- Each player keeps a personal list of quick-chat presets (e.g. "wtf", "yalla", "nice move"),
-- editable in-game or from Manage Profile, synced to their login. Idempotent: safe to re-run.
-- Access stays behind SECURITY DEFINER RPCs (the players table denies anon directly).

-- 1) quick_msgs column: a jsonb array of short strings, or null = "use the app defaults".
alter table public.players add column if not exists quick_msgs jsonb;

-- 2) login / resume now also return the player's quick messages so they arrive on the device.
create or replace function public.player_login(p_name text, p_pin text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  select * into r from players where lower(name) = lower(trim(p_name));
  if not found then return json_build_object('ok', false, 'error', 'No such player'); end if;
  if r.pin_hash <> crypt(p_pin, r.pin_hash) then return json_build_object('ok', false, 'error', 'Wrong PIN'); end if;
  update players set last_seen = now() where id = r.id;
  return json_build_object('ok', true, 'id', r.id, 'name', r.name, 'token', r.token, 'avatar', r.avatar, 'quick_msgs', r.quick_msgs);
end $$;

create or replace function public.player_resume(p_token text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  select * into r from players where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'Session expired'); end if;
  update players set last_seen = now() where id = r.id;
  return json_build_object('ok', true, 'id', r.id, 'name', r.name, 'avatar', r.avatar, 'quick_msgs', r.quick_msgs);
end $$;

-- 3) set the quick-message list. Caps count + total size to protect the row.
create or replace function public.player_set_quick_msgs(p_token text, p_msgs jsonb)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  if p_msgs is null or jsonb_typeof(p_msgs) <> 'array' then
    return json_build_object('ok', false, 'error', 'Bad message list');
  end if;
  if jsonb_array_length(p_msgs) > 16 then return json_build_object('ok', false, 'error', 'Too many messages (max 16)'); end if;
  if char_length(p_msgs::text) > 2000 then return json_build_object('ok', false, 'error', 'Messages too long'); end if;
  select * into r from players where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  update players set quick_msgs = p_msgs where id = r.id;
  return json_build_object('ok', true);
end $$;

-- 4) grant execute on the new setter.
revoke all on function public.player_set_quick_msgs(text, jsonb) from public;
grant execute on function public.player_set_quick_msgs(text, jsonb) to anon, authenticated;
