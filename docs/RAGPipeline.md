# feat/rag-pipeline — Walkthrough

## What Was Built

This branch implements the full **RAG (Retrieval-Augmented Generation) retrieval pipeline** for the Socratic Tutor. It wires together the vector database, the Gemini embedding model, and the chat API so the backend can pull semantically relevant chunks from a student's uploaded documents before generating a response.

---

## Files Changed

### 🆕 New Files

#### `supabase/migrations/0007_match_document_chunks.sql`
Defines the Postgres RPC function `match_document_chunks` that performs cosine similarity search using `pgvector`:
- Takes a query embedding (`vector`), match count, and a list of `uuid[]` document IDs to filter by
- Uses the `<=>` cosine distance operator and the IVFFlat index (from migration `0005`)
- Returns `chunk_id`, `document_id`, `content`, and a `similarity` score
- Applied to Supabase via the migrations system

#### `apps/web/lib/rag.ts`
The core RAG service:
- `getSupabaseClient(accessToken?)` — creates an authenticated Supabase client; uses the user's JWT so Row Level Security policies are enforced correctly
- `retrieveContext(query, documentIds, accessToken?, matchCount?)` — embeds the query with `embedQuery()`, calls `match_document_chunks` RPC, formats the top chunks into a readable Markdown string for LLM consumption
- Returns `''` (empty string) when `documentIds` is empty or no chunks match — safe to use as a no-op

#### `tests/rag.test.ts`
Unit tests using Node's native `node:test` framework. All 3 tests pass:
- ✅ Returns empty string when no documentIds provided
- ✅ Retrieves and formats chunks correctly (mocked fetch for both Gemini embedding + Supabase RPC)
- ✅ Returns empty string when no chunks match

---

### ✏️ Modified Files

#### `apps/web/lib/embedder.ts`
Added `embedQuery(query: string): Promise<number[]>` — a single-query embedding function that bypasses the bulk batching logic used for document uploads. Uses `gemini-embedding-004` at 3072 dimensions.

#### `apps/web/app/sessions/[sessionId]/page.tsx`
Updated `ChatContainer` instantiation to pass `documentIds`:
```tsx
<ChatContainer
    sessionId={sessionId}
    documentIds={documents.map(d => d.document_id)}
/>
```
`ChatContainer` is only rendered after the session data finishes loading, ensuring `documentIds` is always populated.

#### `apps/web/components/chat/ChatContainer.tsx`
Key changes:
- Added `documentIds: string[]` to the component props
- Added a `useRef` + `useEffect` to hold a live reference to `documentIds` (prevents stale closure inside the `sendMessage` call)
- Uses `sendMessage(message, { body: { sessionId, documentIds: documentIdsRef.current } })` — the `ChatRequestOptions.body` second argument to `sendMessage` is the correct API in `@ai-sdk/react` v3 for injecting per-request extra body data

> **Key debugging finding:** `sendMessage` in `@ai-sdk/react` v3 sends its own internal payload `{ id, messages, trigger: "submit-message" }` and does **not** merge the `body` config from `useChat`. The only way to inject extra fields per-request is via `sendMessage`'s second argument `options.body`.

#### `apps/web/app/api/chat/route.ts`
Proof-of-life RAG verification block added (to be integrated into real LLM call in `feat/llm-orchestrator`):
- Reads `documentIds` from the request body (injected by `ChatContainer` via `sendMessage` options)
- Extracts the user's JWT access token from request cookies using `createServerClient` from `@supabase/ssr` — **required** for RLS policies to allow reading `document_chunks`
- Calls `retrieveContext(query, documentIds, accessToken)` and prints results to the terminal
- Diagnostic logs (`🔎 FULL BODY KEYS`, `🔎 documentIds`) intentionally kept for local development visibility

---

## Architecture: Full Request Flow

```
User types message → ChatContainer.sendMessage(msg, { body: { documentIds, sessionId } })
        ↓
POST /api/chat  { messages, documentIds, sessionId, id, trigger }
        ↓
route.ts extracts user JWT from cookies via createServerClient
        ↓
retrieveContext(query, documentIds, accessToken)
        ↓
embedQuery(query)  →  Gemini embedding-004 API  →  float[3072]
        ↓
supabase.rpc('match_document_chunks', { query_embedding, match_count: 5, filter_document_ids })
        ↓  (RLS enforced: auth.uid() must match document owner)
Top-K chunks returned, formatted as Markdown  →  [logged to terminal for now]
        ↓
Mock streaming response returned to client (real LLM integration: next branch)
```

---

## Test Results

```
▶ RAG Pipeline
  ✔ returns empty string if no documentIds are provided (3ms)
  ✔ retrieves and formats chunks correctly from the database (387ms)
  ✔ returns empty string if no chunks match (2ms)
✔ RAG Pipeline (397ms)

tests 3 | pass 3 | fail 0
```

---

## Key Bugs Fixed During Implementation

| Bug | Root Cause | Fix |
|---|---|---|
| `documentIds: undefined` at server | `sendMessage` ignores `useChat`'s `body` config | Pass via `sendMessage(msg, { body: {...} })` second arg |
| `No relevant chunks found` despite DB having chunks | RLS blocked unauthenticated anon client | Extract JWT from cookies in `route.ts`, pass to `retrieveContext` |
| `append is not a function` | `append` does not exist in `@ai-sdk/react` v3 | Use `sendMessage` which is the v3 API |
| `supabaseKey is required` | Missing `SUPABASE_SERVICE_ROLE_KEY` (not used in project) | Use anon key fallback; service role key is intentionally absent |

---

## What Comes Next (`feat/llm-orchestrator`)

1. Remove the proof-of-life `console.log` block from `route.ts`
2. Pass the `context` string into the real `streamText()` LLM call as a system prompt prefix
3. Replace the mock `ReadableStream` with a genuine AI SDK streaming response
