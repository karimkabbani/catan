-- Persistent player identities + PIN auth for the friend-group lobby.
-- PINs are bcrypt-hashed; the table is locked from direct anon access and only
-- reached through these SECURITY DEFINER functions (which run as the owner and
-- bypass RLS). Each player gets a bearer token saved on their device for auto-login.

create extension if not exists pgcrypto;

create table if not exists public.players (
  id         uuid primary key default gen_random_uuid(),
  name       text unique not null,
  pin_hash   text not null,
  token      text not null default replace(gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
alter table public.players enable row level security;   -- no anon policies: direct reads/writes denied

-- names only, for the "pick who you are" screen
create or replace function public.player_list()
  returns json language sql security definer set search_path = public, extensions as $$
  select coalesce(json_agg(name order by name), '[]'::json) from public.players;
$$;

create or replace function public.player_create(p_name text, p_pin text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_token text;
begin
  p_name := trim(p_name);
  if p_name = '' or char_length(p_name) > 20 then return json_build_object('ok', false, 'error', 'Enter a name (max 20 chars)'); end if;
  if char_length(p_pin) < 4 then return json_build_object('ok', false, 'error', 'PIN must be at least 4 digits'); end if;
  if exists (select 1 from players where lower(name) = lower(p_name)) then return json_build_object('ok', false, 'error', 'That name is taken'); end if;
  v_token := replace(gen_random_uuid()::text, '-', '');
  insert into players(name, pin_hash, token) values (p_name, crypt(p_pin, gen_salt('bf')), v_token) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id, 'name', p_name, 'token', v_token);
end $$;

create or replace function public.player_login(p_name text, p_pin text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  select * into r from players where lower(name) = lower(trim(p_name));
  if not found then return json_build_object('ok', false, 'error', 'No such player'); end if;
  if r.pin_hash <> crypt(p_pin, r.pin_hash) then return json_build_object('ok', false, 'error', 'Wrong PIN'); end if;
  update players set last_seen = now() where id = r.id;
  return json_build_object('ok', true, 'id', r.id, 'name', r.name, 'token', r.token);
end $$;

create or replace function public.player_resume(p_token text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  select * into r from players where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'Session expired'); end if;
  update players set last_seen = now() where id = r.id;
  return json_build_object('ok', true, 'id', r.id, 'name', r.name);
end $$;

create or replace function public.player_set_pin(p_token text, p_old text, p_new text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  if char_length(p_new) < 4 then return json_build_object('ok', false, 'error', 'New PIN must be at least 4 digits'); end if;
  select * into r from players where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'Not logged in'); end if;
  if r.pin_hash <> crypt(p_old, r.pin_hash) then return json_build_object('ok', false, 'error', 'Wrong current PIN'); end if;
  update players set pin_hash = crypt(p_new, gen_salt('bf')) where id = r.id;
  return json_build_object('ok', true);
end $$;

revoke all on function public.player_list(), public.player_create(text, text), public.player_login(text, text),
  public.player_resume(text), public.player_set_pin(text, text, text) from public;
grant execute on function public.player_list(), public.player_create(text, text), public.player_login(text, text),
  public.player_resume(text), public.player_set_pin(text, text, text) to anon, authenticated;
