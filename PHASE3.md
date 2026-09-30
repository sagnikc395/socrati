# Phase 3 — Voice Mode (Record Locally, Upload Async)

Goal: let students record a question in the browser, upload it, and get a
Socratic reply grounded in their documents. Async pipeline, same shape as
document ingestion. No realtime audio, no new infrastructure.

Requires Phase 2 done (Drizzle schema, `llm_usage` table, `llm.ts` fallback
wrapper, Redis rate limiting).

## Non-goals

- No WebSockets, no voice gateway, no Go/Python service.
- No live transcription, no end-of-speech detection, no interruption.
- No server-side TTS in V1 (browser `speechSynthesis` for playback).
- No new queue infra, no new database, no new LLM provider keys.

Principle: voice is just another input to the existing chat pipeline.
Record → upload → transcribe → RAG → Socratic reply. If it doesn't run on
`npm run dev` + Vercel serverless, it doesn't ship.

## Why upload-async (not realtime)

- Reuses what exists: multipart upload (`lib/document-upload.ts`), BullMQ on
  Upstash Redis (`lib/queue.ts`), worker process (`lib/worker.ts`),
  `retrieveContext` (`lib/rag.ts`), Socratic prompt (`lib/prompts.ts`).
- Vercel serverless can't hold WebSockets; BullMQ + Supabase Storage can.
- Transcription + RAG + chat are all measurable stages, so Phase 2 logging
  (`llm_usage`, `logger.ts`) applies unchanged.
- DX: one new queue + one worker handler in the same process, one new table,
  two new routes. Nothing to deploy separately.

## Pipeline

```text
Browser (MediaRecorder, webm/opus)
  → POST /api/voice (multipart audio + sessionId + documentIds)
  → Supabase Storage bucket `voice-recordings` + `voice_turns` row (pending)
  → BullMQ `voice-processing` job { voiceTurnId, storagePath }
  → worker: download → Groq Whisper transcribe → retrieveContext → llm.ts chat
  → save transcript + reply to `messages` + mark turn ready
  → client polls GET /api/voice/:id (or existing SSE progress pattern)
  → chat renders transcript as user message, reply as assistant message,
    browser speechSynthesis plays reply
```

### 1. Storage + DB (one migration)

```sql
-- supabase/migrations/0013_voice_turns.sql
create table voice_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id) on delete cascade,
  user_id uuid references profiles(id),
  storage_path text not null,
  mime_type text not null default 'audio/webm',
  duration_ms int,
  status text not null default 'pending', -- pending | processing | ready | failed
  transcript text,
  error_message text,
  stt_ms int, retrieval_ms int, llm_ms int,
  created_at timestamptz default now()
);
```

- Raw audio goes to Storage (`voice-recordings` bucket, private, RLS by
  `user_id`), never base64 through Redis (unlike PDFs — audio is bigger and
  Redis payloads stay small).
- Add `voice_turns` to Drizzle `schema.ts` via `db:generate` (Phase 2 flow).
- Extend Phase 2 `llm_usage`: `feature = 'voice'`, plus STT cost in same row
  (`provider = 'groq'`, `model = 'whisper-large-v3-turbo'`). No schema change.
- Privacy: delete Storage object after transcription succeeds (keep transcript
  - reply only), or auto-expire after 7 days. Same delete-document UX pattern.

### 2. Queue + worker (same process, no new deploy)

- New `voice-processing` queue in `apps/web/lib/voice-queue.ts`, mirroring
  `lib/queue.ts` (attempts 3, exponential backoff, same Redis connection).
- New handler in `apps/web/lib/voice-worker.ts`, registered alongside the
  document worker in `apps/web/lib/worker.ts` (one process, two `Worker`
  instances, existing `DOCUMENT_WORKER_CONCURRENCY` pattern + separate
  `VOICE_WORKER_CONCURRENCY=2`).
- Handler stages, each logged via `logDocument`-style structured log with
  `voiceTurnId`/`jobId`:
  1. `download` from Storage (service role, RLS bypass in worker only).
  2. `transcribe` via Groq Whisper (`whisper-large-v3-turbo`, OpenAI-compatible
     endpoint, existing `GROQ_API_KEY` — zero new secrets).
  3. `retrieveContext(transcript, documentIds, accessToken)` — unchanged.
  4. `llm.ts` chat with `buildSystemPrompt(context)` — unchanged Socratic
     behavior, `feature = 'voice'`.
  5. Insert two `messages` rows (user = transcript, assistant = reply) so voice
     turns appear in normal chat history; mark `voice_turns` ready; delete
     Storage object.
- Failure: mark turn `failed` + `error_message` (same pattern as
  `updateParseStatus`), job retries transient STT/LLM errors only.

### 3. API (two routes, same auth pattern as chat/upload)

- `POST /api/voice` — multipart `audio` + `sessionId` + `documentIds[]`.
  Reuse `handleDocumentUpload` structure: Supabase auth → validate →
  Storage upload → insert `voice_turns` pending → enqueue → return
  `{ voiceTurnId }`. Caps: ≤10 MB, ≤120 s, mime allowlist
  (`audio/webm, audio/mp3, audio/wav, audio/ogg, audio/m4a`). Reuse Phase 2
  Redis rate limit (voice quota stricter, e.g. 10/min).
- `GET /api/voice/:id` — return `{ status, transcript, reply }` for polling.
  (If SSE progress stream from documents fits, reuse it; polling is the V1
  default — simpler client, no persistent connection.)
- Validation mirrors `app/api/chat/route.ts`: UUID checks, RLS via user JWT,
  401/400 shapes unchanged.

### 4. Client (one minimal component)

- `components/voice-recorder.tsx`: hold-to-record / tap-to-stop via
  `MediaRecorder` (default `audio/webm;codecs=opus`, fallback to mp4/m4a where
  unsupported), client-side duration + size guard, upload via `fetch`
  FormData, poll `GET /api/voice/:id` every ~1.5 s, then append transcript +
  reply to chat state and offer browser `speechSynthesis` playback.
- No waveform visualizer, no VAD, no interruption in V1. Push-to-talk only.

## Observability (reuse Phase 2, nothing new)

- One `llm_usage` row per voice turn (`feature='voice'`, STT tokens/cost folded
  in or logged as second row with `feature='voice-stt'` if cleaner).
- One structured log line per turn:
  `upload_ms, stt_ms, retrieval_ms, llm_ttft_ms, total_ms, fallback_used`.
- Queries: p50/p95 upload→ready, STT error rate, fallback rate, share of voice
  vs text turns. All from Supabase dashboard.

## Reliability + evals (reuse Phase 2)

- Fallback: STT retry → mark failed; chat fallback via existing `llm.ts`.
- Cache: transcript hash → skip re-transcribe on re-upload (same content-hash
  idea as embeddings).
- Eval: add 10 noisy-transcript prompts (fillers, misrecognitions) to the
  Phase 2 `npm run eval` set; assert no answer-leak + groundedness hold.

## Execution order

1. **Migration + Storage bucket + Drizzle schema (1 day).**
2. **Queue + worker transcribe→reply loop with a fixture audio file (2–3 days).**
3. **POST/GET routes + rate limits + caps (1–2 days).**
4. **Recorder component + chat integration + speechSynthesis playback (2 days).**
5. **Delete-audio privacy + eval additions + docs (1 day).**

## Files touched

- `supabase/migrations/0013_voice_turns.sql` (new), Storage bucket
  `voice-recordings`, `apps/web/lib/db/schema.ts`
- `apps/web/lib/voice-queue.ts` (new), `apps/web/lib/voice-worker.ts` (new),
  `apps/web/lib/worker.ts` (register second worker)
- `apps/web/lib/voice-upload.ts` (new, mirrors `document-upload.ts`),
  `apps/web/app/api/voice/route.ts` (new), `apps/web/app/api/voice/[id]/route.ts`
- `apps/web/components/voice-recorder.tsx` (new), chat page wiring
- `tests/voice-upload.test.ts`, `tests/voice-worker.test.ts` (mock STT/LLM)

## Out of scope (Phase 4+)

- Server-side TTS (ElevenLabs/OpenAI audio), audio replies in Storage.
- Streaming transcription, VAD auto-stop, barge-in/interruption.
- Realtime speech-to-speech models, WebSocket gateway, separate voice service.
- Voice-based quizzes/mindmaps — text pipeline only.

## Success criteria

A student can record ≤60 s in Chrome/Safari, upload, see transcript + Socratic
reply in chat within ~2× text-chat latency, play it via browser TTS, delete it
with the session — with STT failures surfaced as turn errors (not crashes),
per-turn cost visible in `llm_usage`, and `npm test` still green with STT mocked.
