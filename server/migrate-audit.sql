-- v253: card guard + audit log on the games row.
--
-- 1. catan_card_problems(state): null when the cards add up, else what's wrong. Each resource across all hands +
--    the bank must be exactly 19; no hand or bank below 0; knights (deck + hands + played) exactly 14; victory
--    point cards exactly 5; road building / year of plenty / monopoly at most 2 each (played ones aren't kept).
-- 2. A trigger on games: a write that would break those rules is REFUSED (the row stays as it was; the phone's
--    version-guarded save sees 0 rows, retries, then re-syncs to the server's copy) and logged. A game that was
--    already broken before this went in is never frozen: its writes are allowed and logged.
-- 3. game_audit: one row per write that changed anyone's cards (or the bank), with the change per player, who
--    wrote it (state._w = device id), the app version (state._av) and the move (state._a). Kept 30 days.
--    Readable only from the SQL editor (no browser access).
--
-- Safe to run more than once.

create table if not exists public.game_audit (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  code      text not null,
  v_old     bigint,
  v_new     bigint,
  writer    text,      -- device id of the phone that wrote it
  app       text,      -- its app version
  action    text,      -- the move (e.g. bankExchange, confirmTrade)
  turn_of   text,      -- whose turn it was
  hands     jsonb,     -- per player, per resource: + gained / - lost; "dev": change in dev cards held
  bank      jsonb,     -- the bank's change
  problems  jsonb,     -- what didn't add up (null = all fine)
  refused   boolean not null default false,
  old_build boolean not null default false   -- v254: saved by a build older than v254 (writer/app/action unknown)
);
create index if not exists game_audit_code_at on public.game_audit (code, at desc);
alter table public.game_audit enable row level security;   -- no policies: browsers can't read or write it
revoke all on public.game_audit from anon, authenticated;

create or replace function public.catan_card_problems(st jsonb) returns jsonb
language plpgsql immutable as $$
declare
  r text; d text; n int; want int; out jsonb := '{}'::jsonb;
begin
  if st is null or jsonb_typeof(st->'players') <> 'array' or jsonb_typeof(st->'bank') <> 'object' then return null; end if;
  foreach r in array array['brick','wood','sheep','wheat','ore'] loop
    select coalesce((st->'bank'->>r)::int, 0) + coalesce(sum((p->'resources'->>r)::int), 0) into n
      from jsonb_array_elements(st->'players') p;
    if n <> 19 then out := out || jsonb_build_object(r, n); end if;
    if coalesce((st->'bank'->>r)::int, 0) < 0
       or exists (select 1 from jsonb_array_elements(st->'players') p where coalesce((p->'resources'->>r)::int, 0) < 0)
    then out := out || jsonb_build_object(r || '_negative', true); end if;
  end loop;
  foreach d in array array['knight','victory_point','road_building','year_of_plenty','monopoly'] loop
    select count(*) into n from (
      select c from jsonb_array_elements_text(coalesce(st->'devDeck', '[]'::jsonb)) c
      union all select c from jsonb_array_elements(st->'players') p, jsonb_array_elements_text(coalesce(p->'devCards', '[]'::jsonb)) c
      union all select c from jsonb_array_elements(st->'players') p, jsonb_array_elements_text(coalesce(p->'newDevCards', '[]'::jsonb)) c
    ) x where x.c = d;
    if d = 'knight' then
      select n + coalesce(sum(coalesce((p->>'playedKnights')::int, 0)), 0) into n from jsonb_array_elements(st->'players') p;
    end if;
    want := case d when 'knight' then 14 when 'victory_point' then 5 else 2 end;
    if (d in ('knight', 'victory_point') and n <> want) or n > want then out := out || jsonb_build_object(d, n); end if;
  end loop;
  return case when out = '{}'::jsonb then null else out end;
end $$;

create or replace function public.games_card_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  bad jsonb; oldbad jsonb; hands jsonb := '{}'::jsonb; bankd jsonb := '{}'::jsonb;
  pn jsonb; po jsonb; diff jsonb; r text; delta int; same_game boolean; old_build boolean := false;
begin
  if new.state is null then return new; end if;
  bad := public.catan_card_problems(new.state);
  same_game := tg_op = 'UPDATE' and old.state is not null and old.state->'board' = new.state->'board';
  if same_game then
    oldbad := public.catan_card_problems(old.state);
    -- v254+ puts a fresh tag (_n) on every save; an older build copies the previous save's tags
    old_build := new.state->>'_n' is null or new.state->>'_n' is not distinct from old.state->>'_n';
    for pn in select * from jsonb_array_elements(new.state->'players') loop
      select p into po from jsonb_array_elements(old.state->'players') p where p->>'color' = pn->>'color';
      diff := '{}'::jsonb;
      foreach r in array array['brick','wood','sheep','wheat','ore'] loop
        delta := coalesce((pn->'resources'->>r)::int, 0) - coalesce((po->'resources'->>r)::int, 0);
        if delta <> 0 then diff := diff || jsonb_build_object(r, delta); end if;
      end loop;
      delta := jsonb_array_length(coalesce(pn->'devCards', '[]'::jsonb)) + jsonb_array_length(coalesce(pn->'newDevCards', '[]'::jsonb))
             - coalesce(jsonb_array_length(po->'devCards'), 0) - coalesce(jsonb_array_length(po->'newDevCards'), 0);
      if delta <> 0 then diff := diff || jsonb_build_object('dev', delta); end if;
      if diff <> '{}'::jsonb then hands := hands || jsonb_build_object(pn->>'color', diff); end if;
    end loop;
    foreach r in array array['brick','wood','sheep','wheat','ore'] loop
      delta := coalesce((new.state->'bank'->>r)::int, 0) - coalesce((old.state->'bank'->>r)::int, 0);
      if delta <> 0 then bankd := bankd || jsonb_build_object(r, delta); end if;
    end loop;
  end if;
  if bad is not null or hands <> '{}'::jsonb or bankd <> '{}'::jsonb then
    insert into public.game_audit (code, v_old, v_new, writer, app, action, turn_of, hands, bank, problems, refused, old_build)
    values (new.code, case when tg_op = 'UPDATE' then old.version end, new.version,
            case when old_build then null else new.state->>'_w' end,
            case when old_build then 'before v254' else new.state->>'_av' end,
            case when old_build then null else new.state->>'_a' end,
            new.state->'order'->>(coalesce((new.state->>'currentPlayerIndex')::int, 0)),
            nullif(hands, '{}'::jsonb), nullif(bankd, '{}'::jsonb), bad, bad is not null and oldbad is null, old_build);
  end if;
  if random() < 0.002 then delete from public.game_audit where at < now() - interval '30 days'; end if;
  -- refuse a write that breaks the card rules, unless the game was already broken before it
  if bad is not null and oldbad is null then return null; end if;
  return new;
end $$;

drop trigger if exists games_card_guard on public.games;
create trigger games_card_guard before insert or update on public.games
  for each row execute function public.games_card_guard();
