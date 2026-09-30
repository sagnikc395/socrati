-- ── 0013_voice_turns.sql ─────────────────────────────────────────────────────
-- Phase 3 voice mode: one row per recorded voice turn. Raw audio lives in the
-- private `voice-recordings` Storage bucket (never base64 through Redis);
-- storage_path is the object key and is deleted once transcription succeeds.

-- ── 1. voice_turns ───────────────────────────────────────────────────────────
create table if not exists public.voice_turns (
    id            uuid        primary key default gen_random_uuid(),
    session_id    uuid        not null references public.sessions (session_id) on delete cascade,
    user_id       uuid        not null references public.users (user_id) on delete cascade,
    storage_path  text        not null,
    mime_type     text        not null default 'audio/webm',
    duration_ms   int,
    status        text        not null default 'pending'
        check (status in ('pending', 'processing', 'ready', 'failed')),
    transcript    text,
    reply         text,
    error_message text,
    -- sha256 of the audio bytes: re-uploading the same clip skips Whisper
    -- (same reuse idea as document_chunks.content_hash in 0012)
    audio_hash    text,
    stt_ms        int,
    retrieval_ms  int,
    llm_ms        int,
    created_at    timestamptz not null default now()
);

create index if not exists voice_turns_session_idx
    on public.voice_turns (session_id, created_at);

create index if not exists voice_turns_audio_hash_idx
    on public.voice_turns (user_id, audio_hash);

alter table public.voice_turns enable row level security;

drop policy if exists "voice_turns: select own" on public.voice_turns;
drop policy if exists "voice_turns: insert own" on public.voice_turns;
drop policy if exists "voice_turns: delete own" on public.voice_turns;

create policy "voice_turns: select own"
    on public.voice_turns for select
    using (auth.uid() = user_id);

create policy "voice_turns: insert own"
    on public.voice_turns for insert
    with check (auth.uid() = user_id);

create policy "voice_turns: delete own"
    on public.voice_turns for delete
    using (auth.uid() = user_id);

-- ── 2. Storage bucket ────────────────────────────────────────────────────────
-- Private bucket; objects are uploaded under <user_id>/<turns>.webm so the
-- owner check can key off either `owner` or the path prefix.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'voice-recordings',
    'voice-recordings',
    false,
    10485760, -- 10 MB, matches the API cap
    array['audio/webm', 'audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/mp4', 'audio/x-m4a']
)
on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "voice-recordings: insert own" on storage.objects;
drop policy if exists "voice-recordings: select own" on storage.objects;
drop policy if exists "voice-recordings: delete own" on storage.objects;

create policy "voice-recordings: insert own"
    on storage.objects for insert to authenticated
    with check (
        bucket_id = 'voice-recordings'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "voice-recordings: select own"
    on storage.objects for select to authenticated
    using (
        bucket_id = 'voice-recordings'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

create policy "voice-recordings: delete own"
    on storage.objects for delete to authenticated
    using (
        bucket_id = 'voice-recordings'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

notify pgrst, 'reload schema';
