-- The move log: every saved move of every online game, kept for good, so any game can be replayed exactly and each
-- player's decisions studied (HANDOVER §8, "Record every move"). The engine is deterministic (all dice, steals and
-- dev-card draws come from state.rngState), so a game's starting state plus its moves in order IS the whole game,
-- hidden cards included. server/moves/replay.mjs rebuilds games from this table and checks every step.
--
-- 1. game_moves: one row per save of a game, in save order (id).
--    kind 'start': a game's first save. snap = the whole state (board, seed, the shuffled dev deck), seats = who sat
--                  where (seat, colour, name, player id). label 'new' for a fresh game, 'mid-game' for a game that was
--                  already running when this log was switched on (the replay starts from there).
--    kind 'move' : an engine move, tagged by the app (state._act, from the build that added this log).
--                  action = the move exactly as the engine got it, actor = the seat colour that made it, auto = the
--                  app made it for them ('roll' the automatic dice roll, 'steal' the only possible steal, 'decline'
--                  the "auto-decline this turn" setting). chk = the rng cursor, bank, every hand and the turn after
--                  the move, so a replay can prove it stayed in step.
--    kind 'meta' : any other save: the who-starts game, flags and surrender votes, rematch votes, quits, and moves
--                  saved by an older build. patch = the top-level state keys that changed, with their new values;
--                  gone = keys that were removed. Applying them to the previous state gives the new state exactly.
--    kind 'close': the table was reset (state cleared) before the game ended.
--    Every row: at (server time, so thinking time between moves), version, label (the app's tag for the save),
--    app (the writer's app version), writer (its device id). seats is repeated on any save where the seating changed.
--    The save that ends a game also carries snap (the end state without the board): the ground truth for a replay.
-- 2. Each game gets an id, state.gid, on its first save (a fresh state has none; every later save keeps it because
--    the app always builds on the server's copy). game_results.final carries it too (final->>'gid'), which links a
--    finished game's result to its moves. Older rows in game_results have no gid.
-- 3. games_log never blocks a save: if logging fails, the save goes through unlogged (a warning in the database log).
--    It runs after the card guard: triggers of the same kind run in name order (games_card_guard, games_log,
--    games_touch), so a refused write never reaches it, and a write that fails takes its log row with it.
-- 4. Size: about 21 KB for the start (mostly the board), ~0.35 KB a move, the end state: ~130 KB for a real game of
--    ~300 saves, so ~65 MB a year at the 2026 pace of ~500 games (the whole database was 17 MB on 2026-11-22).
-- Readable only from the SQL editor (no browser access). Safe to run more than once.

create table if not exists public.game_moves (
  id      bigserial primary key,
  gid     text not null,
  code    text not null,
  version bigint,
  at      timestamptz not null default clock_timestamp(),
  kind    text not null,   -- start | move | meta | close
  actor   text,            -- move: the seat colour that made it
  auto    text,            -- move: made by the app for that player (roll | steal | decline), null = their own choice
  action  jsonb,           -- move: the engine action
  label   text,            -- the app's tag for the save (state._a), or new / mid-game / reset
  app     text,            -- the writer's app version
  writer  text,            -- the writer's device id
  chk     jsonb,           -- move: {g: rng cursor, b: bank, h: hands, t: whose turn, p: turn phase}, resources as [brick, wood, sheep, wheat, ore]
  patch   jsonb,           -- meta: changed keys -> new values
  gone    jsonb,           -- meta: removed keys
  snap    jsonb,           -- start: the whole state; the game's last save: the end state without the board
  seats   jsonb            -- start, and any save that changed the seating
);
create index if not exists game_moves_gid on public.game_moves (gid, id);
create index if not exists game_moves_at on public.game_moves (at desc);
alter table public.game_moves enable row level security;   -- no policies: browsers can't read or write it
revoke all on public.game_moves from anon, authenticated;
revoke all on sequence public.game_moves_id_seq from anon, authenticated;

-- the seat map without photos (players[].avatar can be a whole image)
create or replace function public.catan_seats(p jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(p) = 'array' then coalesce((
    select jsonb_agg(jsonb_build_object('seat', x->'seat', 'color', x->'color', 'name', x->'name', 'playerId', x->'playerId') order by o)
      from jsonb_array_elements(p) with ordinality a(x, o)), '[]'::jsonb) end
$$;

create or replace function public.games_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  st jsonb := new.state;
  ost jsonb := case when tg_op = 'UPDATE' then old.state end;
  tags text[] := array['_w', '_av', '_a', '_n', '_act'];
  g text; act jsonb; seats_now jsonb; seats_chg jsonb; p jsonb; gone jsonb; endsnap jsonb;
  res text[] := array['brick', 'wood', 'sheep', 'wheat', 'ore'];
begin
  -- the log must never cost a move: if anything below fails, the save goes through unlogged (a warning in the
  -- database log), with its game id if it already got one
  begin
  -- the table was reset: note it if the game hadn't finished
  if st is null or jsonb_typeof(st) <> 'object' then
    if st is null and jsonb_typeof(ost) = 'object' and ost->>'gid' is not null and ost->>'phase' is distinct from 'ended' then
      insert into game_moves (gid, code, version, kind, label) values (ost->>'gid', old.code, old.version, 'close', 'reset');
    end if;
    return new;
  end if;
  seats_now := catan_seats(new.players);
  if tg_op = 'UPDATE' and seats_now is distinct from catan_seats(old.players) then seats_chg := seats_now; end if;

  -- a new game: no id yet (a fresh state from Start or Rematch), or nothing before it
  if st->>'gid' is null or jsonb_typeof(ost) is distinct from 'object' or ost->>'gid' is distinct from st->>'gid' then
    g := coalesce(st->>'gid', gen_random_uuid()::text);
    st := jsonb_set(st, '{gid}', to_jsonb(g));
    new.state := st;
    insert into game_moves (gid, code, version, kind, label, app, writer, snap, seats)
    values (g, new.code, new.version, 'start',
            case when st->>'phase' = 'setup' and coalesce(st->'settlements', '{}'::jsonb) = '{}'::jsonb then 'new' else 'mid-game' end,
            st->>'_av', st->>'_w', st, seats_now);
    return new;
  end if;
  g := st->>'gid';

  -- the save that ends the game keeps the end state
  if st->>'phase' = 'ended' and ost->>'phase' is distinct from 'ended' then endsnap := st - 'board'; end if;

  act := st->'_act';
  if jsonb_typeof(act) = 'object' and act->>'n' is not null and act->>'n' = st->>'_n' and ost->>'_n' is distinct from st->>'_n' then
    insert into game_moves (gid, code, version, kind, actor, auto, action, label, app, writer, chk, snap, seats)
    values (g, new.code, new.version, 'move', act->>'by', act->>'auto', act->'a', st->>'_a', st->>'_av', st->>'_w',
            jsonb_build_object(
              'g', st->'rngState',
              'b', (select jsonb_agg(st->'bank'->r order by i) from unnest(res) with ordinality u(r, i)),
              'h', (select jsonb_agg((select jsonb_agg(x->'resources'->r order by i) from unnest(res) with ordinality u(r, i)) order by o)
                      from jsonb_array_elements(case when jsonb_typeof(st->'players') = 'array' then st->'players' else '[]'::jsonb end) with ordinality a(x, o)),
              't', st->'currentPlayerIndex',
              'p', st->'turnPhase'),
            endsnap, seats_chg);
    return new;
  end if;

  -- anything else: record exactly what changed
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into p
    from jsonb_each(st) e where e.key <> all(tags) and (ost->e.key) is distinct from e.value;
  select coalesce(jsonb_agg(k order by k), '[]'::jsonb) into gone
    from jsonb_object_keys(ost) k where k <> all(tags) and not (st ? k);
  if p = '{}'::jsonb and gone = '[]'::jsonb and seats_chg is null then return new; end if;   -- only the save tags moved
  insert into game_moves (gid, code, version, kind, label, app, writer, patch, gone, snap, seats)
  values (g, new.code, new.version, 'meta', st->>'_a', st->>'_av', st->>'_w', p, nullif(gone, '[]'::jsonb), endsnap, seats_chg);
  return new;
  exception when others then
    raise warning 'games_log: % (%), save of % v% kept unlogged', sqlerrm, sqlstate, new.code, new.version;
    return new;
  end;
end $$;

drop trigger if exists games_log on public.games;
create trigger games_log before insert or update on public.games
  for each row execute function public.games_log();

-- one line per recorded game (the SQL editor's starting point)
create or replace view public.game_move_games with (security_invoker = true) as
select gid,
       min(code) as code,
       min(at) as started_at,
       max(at) as last_at,
       count(*) filter (where kind = 'move') as moves,
       count(*) filter (where kind = 'meta') as other_saves,
       (array_agg(label order by id) filter (where kind = 'start'))[1] as start,
       (array_agg(seats order by id) filter (where seats is not null))[1] as seats,
       bool_or(kind <> 'start' and snap is not null) as finished,
       bool_or(kind = 'close') as reset
  from public.game_moves group by gid;
revoke all on public.game_move_games from anon, authenticated;
