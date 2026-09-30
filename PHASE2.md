# Phase 2 — DX Hardening

Goal: make Socrati easy to run, change, and debug. No new services, no new
infrastructure. Every change must work with the current setup: `npm run dev`
(Next.js + BullMQ worker), Supabase (Postgres + pgvector), Upstash Redis,
Vercel deploy.

## Non-goals

- No voice mode in Phase 2 (moved to Phase 3 stretch, see bottom).
- No Prometheus / OpenTelemetry Collector / Grafana stack.
- No Go/Python gateway, no WebSockets, no realtime speech-to-speech.
- No new databases, queues, or analytics pipelines.

Principle: if it doesn't run on `npm install && npx supabase db push && npm run dev`,
it doesn't ship in Phase 2.

## Why this scope

Current pain points:

1. 11 raw-SQL migrations in `supabase/migrations/` + raw queries in
   `apps/web/lib/repository.ts`. No types, fear of editing schema.
2. Debugging chat/ingestion means grepping Vercel + worker logs. No per-request
   timing, no cost/usage numbers.
3. Single LLM provider (Groq), no rate limits, re-embeds identical files,
   no regression test for the core promise (ask questions, don't give answers).

Phase 2 fixes exactly these three, nothing else.

---

## 1. Type-safe data layer (Drizzle)

**Problem:** raw SQL everywhere, schema drift risk.

**Approach:** add Drizzle as a typed wrapper, don't rewrite history.

- Add `drizzle-orm` + `drizzle-kit` (postgres-js driver via Supabase pooler).
- Add `apps/web/lib/db/schema.ts` matching the current DB state (baseline from
  migrations `0001`–`0011`). Old migrations stay untouched.
- Replace queries in `apps/web/lib/repository.ts` incrementally, one table at
  a time (documents → chunks → sessions → messages → quiz).
- Keep `match_document_chunks` as raw SQL (pgvector RPC). Wrap it in a typed
  Drizzle helper, don't reimplement it.
- Env access stays through `lib/load-env.ts`. One new var max: `DATABASE_URL`
  (pooled connection string).

New scripts:

```bash
npm run db:generate  # drizzle-kit generate from schema.ts
npm run db:push      # drizzle-kit push (local dev only)
npm run db:studio    # drizzle-studio for inspection
```

**Done when:**

- [ ] `npm run check-types` covers all DB rows (no `any` for documents/chunks/sessions).
- [ ] New schema change = edit `schema.ts` + generated migration, no hand-written ALTER.
- [ ] `npm test` still passes with `EMBEDDING_MOCK=true`.

## 2. Lightweight observability (Postgres + logs)

**Problem:** the old plan needed OTel Collector + `prom-client` `/metrics` +
Grafana. None of that fits Vercel serverless, and it's three new things to run
locally.

**Approach:** structured logs + one Postgres table. Query via Supabase
dashboard. Zero new infra.

Add one table:

```sql
-- supabase/migrations/0012_llm_usage.sql
create table llm_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id),
  session_id uuid references sessions(id),
  feature text not null,          -- chat | quiz | mindmap
  provider text not null,         -- groq | fallback
  model text not null,
  input_tokens int, output_tokens int, cost_usd numeric,
  ttft_ms int, total_ms int,
  cache_hit boolean default false,
  fallback_used boolean default false,
  created_at timestamptz default now()
);
```

No `user_id` labels in metrics systems — per-user data lives here, one row per
LLM call.

Extend existing `apps/web/lib/logger.ts` (don't add an OTel SDK):

- Include `requestId` (API routes) / `jobId` (worker) on every log line.
- One log line per chat turn with timings as fields:
  `auth_ms, retrieval_ms, web_fallback, llm_ttft_ms, total_ms`.
- Same for ingestion: `upload_to_ready_ms, parse_ms, embed_ms, file_type`.

Four queries replace the dashboard:

1. p95 chat TTFT (`llm_usage` where `feature = 'chat'`).
2. Upload → ready latency + parse failure rate by file type (worker logs).
3. Fallback usage rate (`fallback_used = true`).
4. API error rate (route logs).

**Done when:**

- [ ] Every chat turn writes one `llm_usage` row + one structured log line.
- [ ] Can answer "p95 TTFT this week?" from Supabase dashboard in <1 min.
- [ ] No new env vars for observability, no `/metrics` endpoint, no collector.

## 3. Boring reliability defaults

Small, high-leverage, all reuse existing deps. Each is <1 day.

- **Provider fallback:** Groq primary + one fallback with timeout (~8s) and a
  simple circuit breaker. Record in `llm_usage.fallback_used`. Touch only
  `apps/web/lib/groq.ts` (+ new `apps/web/lib/llm.ts` wrapper).
- **Per-user rate limiting:** sliding window in middleware/API routes using the
  existing Upstash Redis (`apps/web/lib/redis.ts`). Start with chat only,
  e.g. 30 req/min. Return 429, no new service.
- **Embedding + generation cache:** sha256 content hash on chunks — re-uploads
  skip re-embedding. Cache quiz/mindmap per `document_id` in Postgres.
  Touch `apps/web/lib/embedder.ts`, `quiz.ts`, `mindmap.ts`.
- **Socratic eval (small):** 20 prompts (not 50–100), including 5 answer-extraction
  attempts. LLM-judge scores: (a) answer-leak rate, (b) groundedness. Runs as
  `npm run eval`, fails CI on regression vs. checked-in baseline. Calibrate judge
  once against ~20 hand-labeled examples.

**Done when:**

- [ ] Kill primary provider in dev → fallback serves chat, counter increments.
- [ ] Spam chat → 429 after limit, no crash.
- [ ] Re-upload same file → 0 new embedding calls.
- [ ] `npm run eval` passes in CI.

---

## Execution order

1. **Drizzle baseline (2–4 days).** Unblocks everything else safely.
2. **Usage table + structured logs (2–3 days).** Gives baseline numbers before
   touching reliability.
3. **Fallback → rate limit → cache → eval (3–5 days).** Each merges independently.

Total: ~2 weeks. Do not start 3 before 2 — otherwise there is no before/after.

## Files touched

- `apps/web/lib/db/schema.ts` (new), `apps/web/lib/repository.ts`
- `supabase/migrations/0012_llm_usage.sql` (new, only new migration)
- `apps/web/lib/logger.ts`, `apps/web/lib/rag.ts`, `apps/web/lib/worker.ts`
- `apps/web/lib/groq.ts` → `apps/web/lib/llm.ts`, `apps/web/lib/redis.ts`
- `apps/web/lib/embedder.ts`, `quiz.ts`, `mindmap.ts`
- `tests/` — extend existing `*.test.ts`, plus `eval/` baseline (20 prompts)

## Out of scope (Phase 3+)

- **Voice mode — see `PHASE3.md`.** If revisited: record-locally + upload-async
  only, cascaded STT → existing RAG → TTS, no gateway, no interruption, no VAD.
  Reuses `llm_usage` for cost/min. Needs real-user demand first.
- Prometheus / Grafana / OTel Collector, Go/Python services, WebSockets,
  realtime models, separate product-events pipeline, multi-provider routing
  beyond one fallback.

## Success criteria

Phase 2 is done when a new contributor can:

```bash
npm install
npx supabase db push
npm run dev
npm test
```

...and then rename a column via `schema.ts` + `db:generate`, see chat TTFT in
Supabase, and break the Socratic behavior without CI catching it — none of
which require reading raw SQL or standing up extra infrastructure.
