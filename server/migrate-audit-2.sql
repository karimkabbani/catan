-- v254: the audit log marks saves made by an app build older than v254 (old_build). Those builds copy the previous
-- save's tags (_w device, _av version, _a move), so for them the log now records "before v254" instead of naming the
-- wrong phone. Replaces games_card_guard() from migrate-audit.sql; everything else there is unchanged. Safe to re-run.

alter table public.game_audit add column if not exists old_build boolean not null default false;

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

