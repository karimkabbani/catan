-- Chat transport migration — run once on the Catan Supabase project.
-- Moves quick-chat + voice notes off flaky realtime "broadcast" onto a polled table (the same
-- reliable pattern the game state uses), so messages survive iOS/PWA WebSocket drops.
-- Rows are deleted when the game ends (client) + a stale sweep. Idempotent: safe to re-run.

create table if not exists public.messages (
  id         bigserial primary key,
  code       text not null,                 -- game code the message belongs to
  color      text,                          -- sender's seat colour
  name       text,
  avatar     text,
  type       text not null default 'text',  -- 'text' | 'voice'
  body       text,                          -- text content (for 'text')
  url        text,                          -- voice clip URL (for 'voice')
  dur        int,                           -- voice duration (s)
  sender     text,                          -- sender's persistent player id
  created_at timestamptz not null default now()
);
create index if not exists messages_code_id on public.messages (code, id);

-- realtime: clients also postgres_changes-subscribe for immediacy (poll is the reliable fallback).
alter table public.messages replica identity full;
do $$ begin
  begin alter publication supabase_realtime add table public.messages; exception when duplicate_object then null; end;
end $$;

-- friendly game: the anon (browser) role can read/insert/delete (mirrors public.games).
grant usage on schema public to anon, authenticated;
grant select, insert, delete on public.messages to anon, authenticated;
grant usage, select on sequence public.messages_id_seq to anon, authenticated;

alter table public.messages enable row level security;
drop policy if exists messages_read   on public.messages;
drop policy if exists messages_insert on public.messages;
drop policy if exists messages_delete on public.messages;
create policy messages_read   on public.messages for select using (true);
create policy messages_insert on public.messages for insert with check (true);
create policy messages_delete on public.messages for delete using (true);
