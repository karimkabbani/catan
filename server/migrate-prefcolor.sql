-- Preferred player color — run once on the Catan Supabase project.
-- Each player can pick the color they'd like to play (red/blue/green/yellow), stored on their
-- login like quick_msgs. At game start the host honours preferences; ties go to a random
-- claimant and everyone else gets a free color. Idempotent: safe to re-run.

-- 1) pref_color column: one of the four seat colors, or null = "no preference".
alter table public.players add column if not exists pref_color text;

-- 2) login / resume also return the preference so it arrives on the device.
create or replace function public.player_login(p_name text, p_pin text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  select * into r from players where lower(name) = lower(trim(p_name));
  if not found then return json_build_object('ok', false, 'error', 'No such player'); end if;
  if r.pin_hash <> crypt(p_pin, r.pin_hash) then return json_build_object('ok', false, 'error', 'Wrong PIN'); end if;
  update players set last_seen = now() where id = r.id;
  return json_build_object('ok', true, 'id', r.id, 'name', r.name, 'token', r.token, 'avatar', r.avatar,
    'quick_msgs', r.quick_msgs, 'pref_color', r.pref_color);
end $$;

create or replace function public.player_resume(p_token text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  select * into r from players where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'Session expired'); end if;
  update players set last_seen = now() where id = r.id;
  return json_build_object('ok', true, 'id', r.id, 'name', r.name, 'avatar', r.avatar,
    'quick_msgs', r.quick_msgs, 'pref_color', r.pref_color);
end $$;

-- 3) set (or clear) the preferred color.
create or replace function public.player_set_pref_color(p_token text, p_color text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  select * into r from players where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'Session expired'); end if;
  if p_color is not null and p_color not in ('red', 'blue', 'green', 'yellow') then
    return json_build_object('ok', false, 'error', 'Bad color');
  end if;
  update players set pref_color = p_color where id = r.id;
  return json_build_object('ok', true, 'pref_color', p_color);
end $$;

grant execute on function public.player_set_pref_color(text, text) to anon, authenticated;
