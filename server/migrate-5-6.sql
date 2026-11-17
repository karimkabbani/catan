-- 5-6 player games. Safe to run more than once.
--
-- 1. catan_card_problems(state): the card guard on games (migrate-audit.sql) counted every game as a 2-4 player
--    game: 19 of each resource, 14 knights, at most 2 of each progress card. A 5-6 player game uses the extension's
--    bigger supply (24 of each resource, 20 knights, at most 3 road building / year of plenty / monopoly; still 5
--    victory point cards), so without this every save of a 5-6 player game would be refused. The size is read from
--    the game itself (5 or more players = the big supply). 2-4 player games are checked exactly as before.
-- 2. player_set_pref_color: also accepts the two new seat colours, purple and black.

create or replace function public.catan_card_problems(st jsonb) returns jsonb
language plpgsql immutable as $$
declare
  r text; d text; n int; want int; out jsonb := '{}'::jsonb;
  big boolean; res_total int; knights int; progress int;
begin
  if st is null or jsonb_typeof(st->'players') <> 'array' or jsonb_typeof(st->'bank') <> 'object' then return null; end if;
  big := jsonb_array_length(st->'players') >= 5;
  res_total := case when big then 24 else 19 end;
  knights := case when big then 20 else 14 end;
  progress := case when big then 3 else 2 end;
  foreach r in array array['brick','wood','sheep','wheat','ore'] loop
    select coalesce((st->'bank'->>r)::int, 0) + coalesce(sum((p->'resources'->>r)::int), 0) into n
      from jsonb_array_elements(st->'players') p;
    if n <> res_total then out := out || jsonb_build_object(r, n); end if;
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
    want := case d when 'knight' then knights when 'victory_point' then 5 else progress end;
    if (d in ('knight', 'victory_point') and n <> want) or n > want then out := out || jsonb_build_object(d, n); end if;
  end loop;
  return case when out = '{}'::jsonb then null else out end;
end $$;

create or replace function public.player_set_pref_color(p_token text, p_color text)
  returns json language plpgsql security definer set search_path = public, extensions as $$
declare r players;
begin
  select * into r from players where token = p_token;
  if not found then return json_build_object('ok', false, 'error', 'Session expired'); end if;
  if p_color is not null and p_color not in ('red', 'blue', 'green', 'yellow', 'purple', 'black') then
    return json_build_object('ok', false, 'error', 'Bad color');
  end if;
  update players set pref_color = p_color where id = r.id;
  return json_build_object('ok', true, 'pref_color', p_color);
end $$;

grant execute on function public.player_set_pref_color(text, text) to anon, authenticated;
