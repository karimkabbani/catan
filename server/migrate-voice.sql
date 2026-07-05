-- Voice-notes migration — run once on the Catan Supabase project.
-- A public 'voice' bucket holds short WAV clips, scoped by game code (voice/<code>/<file>.wav).
-- Clips are purged when the game ends (client) + a stale sweep; nothing is kept long-term.
-- Idempotent: safe to re-run.

-- 1) the bucket: public read, ~1MB size cap, audio mime types only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('voice', 'voice', true, 1048576, array['audio/wav','audio/x-wav','audio/webm','audio/mp4','audio/ogg','audio/mpeg','audio/aac'])
on conflict (id) do update
  set public = true, file_size_limit = 1048576, allowed_mime_types = excluded.allowed_mime_types;

-- 2) policies on storage.objects for the trusted friend-group (anon key). Read is public anyway,
--    but clients also need insert (upload), delete (cleanup) and select (list for the sweep).
drop policy if exists "voice_read" on storage.objects;
drop policy if exists "voice_insert" on storage.objects;
drop policy if exists "voice_delete" on storage.objects;
create policy "voice_read"   on storage.objects for select using (bucket_id = 'voice');
create policy "voice_insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'voice');
create policy "voice_delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'voice');
