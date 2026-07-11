-- Per-profile game settings (auto-zoom, sounds, music, animation speed) — run once.
-- Settings follow the LOGIN like quick_msgs/pref_color, so they load on any device. Idempotent.

alter table public.players add column if not exists settings jsonb;

create or replace function public.player_login(p_name text, p_pin text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  select * into r from players where lower(name) = lower(trim(p_name));
  if not found then return json_build_object('ok', false, 'error', 'No such player'); end if;
  if r.pin_hash <> crypt(p_pin, r.pin_hash) then return json_build_object('ok', false, 'error', 'Wrong PIN'); end if;
  update players set last_seen = now() where id = r.id;
  return json_build_object('ok', true, 'id', r.id, 'name', r.name, 'token', r.token, 'avatar', r.avatar,
    'quick_msgs', r.quick_msgs, 'pref_color', r.pref_color, 'settings', r.settings);
end $$;

create or replace function public.player_resume(p_token text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  select * into r from players where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'Session expired'); end if;
  update players set last_seen = now() where id = r.id;
  return json_build_object('ok', true, 'id', r.id, 'name', r.name, 'avatar', r.avatar,
    'quick_msgs', r.quick_msgs, 'pref_color', r.pref_color, 'settings', r.settings);
end $$;

create or replace function public.player_set_settings(p_token text, p_settings jsonb)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  select * into r from players where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'Session expired'); end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or char_length(p_settings::text) > 500 then
    return json_build_object('ok', false, 'error', 'Bad settings');
  end if;
  update players set settings = p_settings where id = r.id;
  return json_build_object('ok', true);
end $$;

revoke all on function public.player_set_settings(text, jsonb) from public;
grant execute on function public.player_set_settings(text, jsonb) to anon, authenticated;
