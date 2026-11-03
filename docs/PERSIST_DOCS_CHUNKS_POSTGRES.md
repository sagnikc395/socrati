# feat: persist document chunks to Postgres — Synopsis

**Branch:** `feat/persist_docs_chunks_postgres`
**Patch file:** `persist_docs_chunks_postgres.patch`

---

## Background

The ingestion pipeline — `parse → chunk → embed` — was already wired end-to-end in the worker process (`apps/web/lib/worker.ts`). After a PDF is uploaded and queued, the worker decodes it, splits the text into overlapping chunks, and calls the Gemini `gemini-embedding-001` model to produce a 3072-dimensional embedding vector for every chunk.

The pipeline completed and logged its results, but nothing was actually persisted to the database. Two underlying problems were blocking every write:

1. **The embedding was sent in the wrong format.** pgvector expects the vector value as a JSON string `"[v1,v2,…]"`, but the repository was passing a raw JavaScript `number[]`. Supabase's PostgREST layer does not automatically coerce a JSON array to the `vector` type, so every `document_chunks` insert was silently rejected or errored out.

2. **The ivfflat index was missing.** Migration `0003` altered the `embedding` column from `vector(1536)` to `vector(3072)` and dropped the old index, but never created a replacement. Without the index, every future similarity search would do a full sequential scan across all embedding rows.

---

## What Was Built

### 1. Supabase migration — `supabase/migrations/0005_document_chunks_ivfflat_index.sql`

A new migration that closes the gap left by `0003`. It creates an **IVFFlat approximate nearest-neighbour index** on `public.document_chunks(embedding)` using `vector_cosine_ops`, which matches cosine similarity — the standard metric for Gemini text embeddings.

```sql
create index if not exists document_chunks_embedding_idx
    on public.document_chunks
    using ivfflat (embedding vector_cosine_ops)
    with (lists = 100);
```

- `lists = 100` is a safe default for tables under ~1M rows.
- After a bulk data load the index can be rebuilt with `REINDEX INDEX document_chunks_embedding_idx`.
- Search accuracy can be tuned per-session with `SET ivfflat.probes = 10`.
- `notify pgrst, 'reload schema'` signals PostgREST to pick up the schema change immediately.

**To apply:** run this file in the Supabase SQL editor or via `supabase db push`.

---

### 2. Repository rewrite — `apps/web/lib/repository.ts`

The repository module is the single place where the application writes documents and chunks to Postgres via the Supabase client. It was refactored in two ways.

#### Bug fix — embedding serialisation

The critical one-line fix that unblocks all chunk persistence:

```ts
// Before (broken — JS array, not a pgvector string)
embedding: chunk.embedding

// After (correct — "[v1,v2,…]" string that pgvector accepts)
embedding: JSON.stringify(chunk.embedding)
```

#### `createRepository(clientFactory)` factory pattern

The module now exports a `createRepository` function that accepts a `RepositoryClientFactory` — a function `(accessToken?: string) => RepositoryClient` — instead of hard-coding the Supabase singletons. This makes the repository fully testable without environment variables, module-level mocking, or a live database.

```ts
export function createRepository(clientFactory: RepositoryClientFactory) {
    // returns { createDocument, updateParseStatus, saveChunksForUser, saveChunks }
}
```

The four exported module-level functions (`createDocument`, `updateParseStatus`, `saveChunksForUser`, `saveChunks`) are unchanged in signature — the worker and upload handler continue to call them exactly as before. Internally they delegate to a default repository instance backed by the real Supabase clients.

A thin `wrapSupabaseClient` helper bridges the `SupabaseClient` type (whose query builder returns `PostgrestFilterBuilder`, a `PromiseLike`) to the simpler `RepositoryClient` interface used by the factory, keeping the TypeScript strict-mode check clean.

**Functions exposed:**

| Function | Description |
|---|---|
| `createDocument(params)` | Inserts a `pending` row into `documents` |
| `updateParseStatus(id, status, error?, token?)` | Sets `parse_status` + `error_message` on a document row; used by the worker at each stage transition |
| `saveChunksForUser(id, chunks, token)` | Bulk-inserts all `EmbeddedChunk` rows into `document_chunks` with the corrected embedding format; respects RLS via the user's access token |
| `saveChunks(id, chunks)` | Service-role alias for `saveChunksForUser` — passes no token so the service-role client is used |

---

### 3. Repository test suite — `tests/repository.test.ts`

A new unit-test file (274 lines) covering all four repository functions using Node's built-in `node:test` runner, consistent with the rest of the test suite. No live database or environment variables are required.

**Test infrastructure**

`createMockFactory` builds an injectable `RepositoryClientFactory` that captures every `insert` and `update` call per table and can be configured to return specific errors. It also records every access token passed to the factory so token-forwarding behaviour can be asserted.

```ts
function createMockFactory(opts?: Record<string, TableMockOptions>): {
    factory: RepositoryClientFactory;
    inserts: Record<string, InsertedRow[]>;
    updates: Record<string, UpdatedRow[]>;
    capturedTokens: (string | undefined)[];
}
```

`makeChunk(index, embeddingSize?)` produces a deterministic `EmbeddedChunk` fixture.

**Test coverage (14 cases across 4 suites)**

| Suite | Cases |
|---|---|
| `repository.updateParseStatus` | Writes correct `parse_status`; includes `error_message` when provided; forwards access token; throws on DB error |
| `repository.saveChunksForUser` | Inserts all chunks; serialises embedding as JSON string; maps all column names correctly; stores `null` heading; is a no-op for empty input; forwards access token; throws on DB error |
| `repository.createDocument` | Inserts a `pending` document row with all required fields; throws on DB error |
| `repository.saveChunks` | Delegates to `saveChunksForUser` with no access token (service-role path) |

All 84 tests in the suite pass. TypeScript reports zero errors (`tsc --noEmit`).

---

## End-to-end flow after these changes

```
POST /api/documents/upload
  └─ handleDocumentUpload          creates documents row (parse_status = 'pending')
       └─ BullMQ job enqueued

Worker picks up the job
  ├─ updateParseStatus(id, 'processing')
  ├─ parsePDFFromBuffer             → ParsedDocument
  ├─ chunkDocument                  → Chunk[]
  ├─ embedChunksStrict              → EmbeddedChunk[]  (Gemini, 3072 dims)
  ├─ saveChunksForUser              → INSERT INTO document_chunks  ✓ fixed
  └─ updateParseStatus(id, 'ready') → documents.parse_status = 'ready'  ✓

Stream endpoint polls documents.parse_status until 'ready' | 'failed'
```

---

## Files changed

| File | Type | Summary |
|---|---|---|
| `supabase/migrations/0005_document_chunks_ivfflat_index.sql` | New | IVFFlat cosine index on `document_chunks.embedding` |
| `apps/web/lib/repository.ts` | Modified | Embedding format fix; `createRepository` factory; typed `RepositoryClient` interface |
| `tests/repository.test.ts` | New | 14 unit tests for all repository functions |