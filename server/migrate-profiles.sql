-- Profile feature migration — run once on the Catan Supabase project (SQL editor).
-- Adds a profile picture + lets players rename themselves. Idempotent: safe to re-run.
-- All access stays behind SECURITY DEFINER RPCs (the players table denies anon directly).

-- 1) avatar column: a small base64 JPEG data URL (~20KB), or null for "no photo".
alter table public.players add column if not exists avatar text;

-- 2) player_list now carries the avatar so the home picker + lobby can show faces.
create or replace function public.player_list()
  returns json language sql security definer set search_path = public, extensions as $$
  select coalesce(json_agg(json_build_object('name', name, 'avatar', avatar) order by name), '[]'::json)
  from public.players;
$$;

-- 3) login / resume return the avatar so the signed-in player carries it on their device.
create or replace function public.player_login(p_name text, p_pin text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  select * into r from players where lower(name) = lower(trim(p_name));
  if not found then return json_build_object('ok', false, 'error', 'No such player'); end if;
  if r.pin_hash <> crypt(p_pin, r.pin_hash) then return json_build_object('ok', false, 'error', 'Wrong PIN'); end if;
  update players set last_seen = now() where id = r.id;
  return json_build_object('ok', true, 'id', r.id, 'name', r.name, 'token', r.token, 'avatar', r.avatar);
end $$;

create or replace function public.player_resume(p_token text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  select * into r from players where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'Session expired'); end if;
  update players set last_seen = now() where id = r.id;
  return json_build_object('ok', true, 'id', r.id, 'name', r.name, 'avatar', r.avatar);
end $$;

-- 4) rename: enforces the same uniqueness rule as creation (login is by name).
create or replace function public.player_set_name(p_token text, p_name text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players; v_name text;
begin
  v_name := trim(p_name);
  if v_name = '' or char_length(v_name) > 20 then return json_build_object('ok', false, 'error', 'Enter a name (max 20 chars)'); end if;
  select * into r from players where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  if exists (select 1 from players where lower(name) = lower(v_name) and id <> r.id) then
    return json_build_object('ok', false, 'error', 'That name is taken');
  end if;
  update players set name = v_name where id = r.id;
  return json_build_object('ok', true, 'name', v_name);
end $$;

-- 5) set/clear the profile picture. Hard size cap protects the row + presence payload.
create or replace function public.player_set_avatar(p_token text, p_avatar text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  if p_avatar is not null and char_length(p_avatar) > 200000 then
    return json_build_object('ok', false, 'error', 'Image too large');
  end if;
  select * into r from players where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  update players set avatar = p_avatar where id = r.id;
  return json_build_object('ok', true);
end $$;

-- 6) grants for the two new functions (the updated ones keep their existing grants).
revoke all on function public.player_set_name(text, text), public.player_set_avatar(text, text) from public;
grant execute on function public.player_set_name(text, text), public.player_set_avatar(text, text) to anon, authenticated;
