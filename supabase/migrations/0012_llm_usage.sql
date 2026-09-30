-- ── 0012_llm_usage.sql ───────────────────────────────────────────────────────
-- Phase 2 observability: one row per LLM call. Per-user usage lives here, not
-- in metrics labels. Queried from the Supabase dashboard, e.g. p95 chat TTFT:
--   select percentile_disc(0.95) within group (order by ttft_ms)
--   from llm_usage where feature = 'chat' and created_at > now() - interval '7 days';
--
-- Also adds document_chunks.content_hash for embedding reuse (sha256 of chunk
-- content): re-uploading the same file skips re-embedding entirely.

-- ── 1. llm_usage ─────────────────────────────────────────────────────────────
create table if not exists public.llm_usage (
    id             uuid        primary key default gen_random_uuid(),
    user_id        uuid        references public.users (user_id) on delete set null,
    session_id     uuid        references public.sessions (session_id) on delete set null,
    feature        text        not null,   -- chat | quiz | mindmap
    provider       text        not null,   -- groq | fallback
    model          text        not null,
    input_tokens   int,
    output_tokens  int,
    cost_usd       numeric,
    ttft_ms        int,
    total_ms       int,
    cache_hit      boolean     default false,
    fallback_used  boolean     default false,
    created_at     timestamptz not null default now()
);

create index if not exists llm_usage_created_at_idx
    on public.llm_usage (created_at);

create index if not exists llm_usage_feature_idx
    on public.llm_usage (feature, created_at);

-- No RLS: usage rows are written by trusted server paths (API routes, worker)
-- and read from the dashboard/service role. No anon/user access needed.

-- ── 2. content_hash on document_chunks (embedding reuse) ─────────────────────
alter table public.document_chunks
    add column if not exists content_hash text;

create index if not exists document_chunks_content_hash_idx
    on public.document_chunks (document_id, content_hash);

notify pgrst, 'reload schema';
