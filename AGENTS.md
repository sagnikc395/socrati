# Project knowledge

Socrati — a Socratic AI tutor. Students upload course documents, a BullMQ worker parses/chunks/embeds them into Supabase (pgvector), and a retrieval-grounded chat guides students with questions instead of answers.

## Quickstart
- Setup: `npm install`, then create `.env` (repo root) from the template in BUILD.md
- Database: `npx supabase db push` (applies `supabase/migrations/` in order)
- Dev: `npm run dev` (Next.js on :3000 + BullMQ worker, via `apps/web/scripts/dev.ts`)
- Test: `npm test` (Node's built-in test runner, not Jest)

## Architecture
- Key directories:
  - `apps/web/app/api` — route handlers (upload, SSE progress stream, chat, quiz, mindmap, sessions, progress)
  - `apps/web/lib` — pipeline logic: parser → chunker → embedder → repository; rag, prompts, queue, worker, redis
  - `apps/web/components` — chat UI, sidebar, mind-map panel
  - `packages/*` — shared ui / eslint-config / typescript-config
  - `supabase/migrations` — schema, RLS policies, `match_document_chunks` RPC
  - `tests` — unit tests for the handlers and lib modules
- Data flow: upload → documents row (pending) → BullMQ job → worker parses/chunks/embeds (Gemini gemini-embedding-001 @ 1536 dims, normalized) → chunks saved → parse_status `ready` → SSE notifies client → session/chat does vector search via RPC → Groq streams the Socratic reply → messages persisted.

## Conventions
- Formatting/linting: `npm run lint` (ESLint `--quiet`; warnings don't block), `npm run format` (Prettier). CI also runs `npm run check-types` and `npm test`.
- Patterns to follow: API route handlers keep logic in `lib/*` modules with injected dependencies so tests can stub Supabase/queue clients. Env access goes through `loadEnvFiles()` from `lib/load-env` for non-Next contexts (worker, tests).
- Things to avoid: committing `.env`/`.env.local`/`.env.test`; changing the embedding dimension (1536) without a matching pgvector migration (ivfflat caps at 2000 dims — see migration 0010); blocking lint on pre-existing `no-explicit-any` warnings (enforced via `--quiet`).
