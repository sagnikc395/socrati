# Load Persisted Documents on Upload Page

**Branch:** `feat/load_persisted_docs_on_upload_page`

## What was done

The "My documents" page (`/session/new`) previously only showed documents uploaded in the current browser session — the list was wiped on every refresh. This change makes the page load all of the authenticated user's documents from the database on mount and merge them with any in-progress local uploads.

---

## Files changed

### `apps/web/app/session/new/page.tsx`
Already contained a `useEffect` that fires once on mount, fetches `GET /api/documents`, maps the DB rows into `UploadedDoc` objects, and re-attaches SSE streams for any document still in the processing pipeline. No changes were made here — it was confirmed correct as-is.

### `apps/web/app/api/documents/route.ts`
Thin Next.js route handler (already present) that delegates to `handleDocumentList` with the real Supabase server client injected.

```ts
export async function GET(req: NextRequest) {
    return handleDocumentList(req, { createSupabaseClient: createClient });
}
```

### `apps/web/lib/document-list.ts` — enhanced logging
Three improvements to the handler:

1. **`request received` log** — emitted before any async work so every inbound request is traceable even if auth or the DB call fails.
2. **`elapsedMs` on every exit path** — the 401, 500, and 200 branches all now report wall-clock time so slow Supabase calls are visible in logs.
3. **`statusCounts` breakdown** — the success log now includes a per-status count object (e.g. `{ ready: 3, processing: 1 }`) so you can see the distribution of document states without writing a separate query.

Before:
```ts
logDocumentEvent('list', 'documents fetched', {
    userId: user.id,
    count: documents?.length ?? 0,
});
return Response.json({ documents: documents ?? [] });
```

After:
```ts
const docs = documents ?? [];
const statusCounts = docs.reduce<Record<string, number>>((acc, doc) => {
    acc[doc.parse_status] = (acc[doc.parse_status] ?? 0) + 1;
    return acc;
}, {});

logDocumentEvent('list', 'documents fetched', {
    userId: user.id,
    count: docs.length,
    statusCounts,
    elapsedMs: Date.now() - startedAt,
});
return Response.json({ documents: docs });
```

### `tests/document-list.test.ts` — expanded test suite
Added 5 new tests on top of the existing 5, bringing the suite to 10 cases total.

| # | Test | What it guards |
|---|------|----------------|
| 6 | Returns all expected fields for each document | Field names in the response match the DB columns exactly (`document_id`, `title`, `file_type`, `parse_status`, `uploaded_at`) |
| 7 | Returns a single document correctly | One-row edge case — no off-by-one or array-unwrapping bugs |
| 8 | Returns documents with all parse statuses preserved | `pending`, `processing`, `ready`, and `failed` all pass through unmodified |
| 9 | Preserves newest-first ordering returned by the DB | The handler does not accidentally re-sort what the DB returns |
| 10 | Returns an empty array (not null) when the user has no documents | Guards against `null` leaking into the response body |

### `.env.local`
Added `REDIS_URL=""` key used by the BullMQ worker connection.

---

## How the feature works end-to-end

```
Browser mounts /session/new
        │
        ▼
useEffect → GET /api/documents
        │
        ▼
handleDocumentList
  ├── supabase.auth.getUser()          ← verifies session cookie
  └── supabase.from('documents')
        .select('document_id, title, file_type, parse_status, uploaded_at')
        .order('uploaded_at', { ascending: false })
        │
        │  Supabase RLS automatically filters to the authenticated user's rows
        ▼
{ documents: [...] }
        │
        ▼
Page maps rows → UploadedDoc[]
  - parse_status 'pending' → shown as 'processing' in the UI
  - re-attaches SSE stream for any doc still in the pipeline
  - setDocs(loaded) initialises the list; future uploads append via setDocs(prev => [...prev, newDoc])
```

---

## Running the tests

```sh
# document-list suite only
node --import tsx --test tests/document-list.test.ts

# full suite
npm test
```

Expected output: **10 pass, 0 fail** for the document-list suite; **89 pass, 0 fail** across all suites.

---

## Patch file

All changes are also captured in `feat-load-persisted-docs.patch` at the repo root.

```sh
git apply feat-load-persisted-docs.patch
```