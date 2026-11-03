# Associate Uploaded Documents with Authenticated Users

## Overview

This document describes the changes made to implement the feature that links every uploaded document to its owning Supabase user, ensures the upload API is auth-gated, and makes the `/session/new` page show only the authenticated user's documents.

---

## Problem Statement

The upload route (`POST /api/documents/upload`) was not reading the authenticated user's ID from the session, so documents were created without a `user_id` foreign key. Additionally, the `/session/new` page only showed documents uploaded during the current browser session (in-memory React state) and discarded them on refresh. Users had no way to see previously uploaded documents.

---

## Files Changed

### New Files

| File | Purpose |
|---|---|
| `apps/web/lib/document-list.ts` | Core handler for `GET /api/documents` — authenticates the user, queries the `documents` table (RLS enforces per-user isolation), returns the list ordered by upload date |
| `apps/web/app/api/documents/route.ts` | Thin Next.js route handler that wires `handleDocumentList` to the `GET` method with the server Supabase client |
| `tests/document-list.test.ts` | Unit tests for `handleDocumentList` with injectable deps |

### Modified Files

| File | What Changed |
|---|---|
| `apps/web/app/session/new/page.tsx` | Loads the user's persisted documents from `GET /api/documents` on mount; reattaches SSE listeners for any document still in `pending`/`processing` state; made `file` optional in `UploadedDoc` since persisted docs have no client-side `File` object |
| `.gitignore` | Added `.env.local` so the `apps/web/.env.local` symlink (pointing to the real credentials file) cannot be accidentally committed |

---

## Feature Implementation Detail

### 1. Upload route auth (pre-existing on this branch)

`apps/web/lib/document-upload.ts` already contained the full auth implementation:

- Calls `supabase.auth.getUser()` and `supabase.auth.getSession()` using the server Supabase client (`createClient` from `@/lib/supabase/server`)
- Returns `401 Unauthorized` if no authenticated user or session is found
- Inserts `user_id: user.id` as a foreign key into the `documents` row
- Passes `userId` and `userAccessToken` to the BullMQ job payload

Tests covering these paths already existed in `tests/document-upload.test.ts` and pass.

### 2. GET /api/documents — list user's documents

`handleDocumentList` in `apps/web/lib/document-list.ts`:

- Calls `supabase.auth.getUser()` — returns `401` if no user
- Queries `documents` table selecting `document_id`, `title`, `file_type`, `parse_status`, `uploaded_at`, ordered newest-first
- Supabase Row-Level Security (`documents: select own` policy) automatically filters to the calling user's rows — no `WHERE user_id = ?` clause needed in application code
- Structured logging via `document-logger` on every code path (auth failure, query failure, success with count)
- Uses injectable deps (`ListDependencies`) for full testability without a real database

The route handler at `apps/web/app/api/documents/route.ts` is a one-liner that passes `createClient` as the Supabase factory.

### 3. Session page — loading persisted documents

`apps/web/app/session/new/page.tsx` changes:

- `useEffect` on mount calls `GET /api/documents` and populates the document list with the user's persisted records
- Each DB document is mapped to the `UploadedDoc` shape: `document_id` becomes both the React state key and `documentId`, `parse_status` maps to the UI `ParseStatus` enum (`pending`/`processing` → `processing`, `ready` → `ready`, `failed` → `failed`)
- Any document still in `processing` state on load gets an SSE listener reattached via the existing `listenForStatus` callback so the status badge updates live when the BullMQ job completes
- `file` field made optional (`file?: File`) since persisted documents don't carry the original browser `File` object

### 4. Database schema (pre-existing)

The `documents` table already had:

- `user_id uuid NOT NULL REFERENCES public.users(user_id)` — enforces the FK at the DB level
- RLS policies: `select own`, `insert own`, `update own`, `delete own` — all scoped to `auth.uid() = user_id`
- `parse_status` and `error_message` columns added in migration `0003_document_processing_queue.sql`

No new migrations were required.

---

## Tests

### New: `tests/document-list.test.ts` (5 tests)

| Test | Assertion |
|---|---|
| `returns an empty list when the user has no documents` | 200 with `{ documents: [] }` |
| `returns the authenticated user's documents ordered by upload date` | 200 with correctly shaped array |
| `returns 401 when no authenticated user is found` | 401 with `{ message: 'Unauthorized' }`, nothing queried |
| `returns 401 when auth returns an error` | 401 even when `getUser` returns an error object |
| `returns 500 when the database query fails` | 500 with the DB error message |

### Existing: `tests/document-upload.test.ts` (4 tests, all passing)

Covers the upload handler's auth path, `user_id` in the insert row, 401 on missing auth, and job enqueue failure marking the document as failed.

All 9 tests pass: `npm test`

---

## Infrastructure Fixes (resolved during development)

### Redis URL

BullMQ requires a `rediss://` Redis protocol URL, not the Upstash REST API URL. The `.env` file needed:

```
REDIS_URL=rediss://default:<token>@<host>.upstash.io:6379
```

`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are for the HTTP REST client only and are not compatible with BullMQ/IORedis.

### Environment file discovery

Next.js only reads env files from its own working directory (`apps/web/`). The real credentials lived in the repo root `.env`. A symlink was added:

```
apps/web/.env.local -> ../../.env
```

This lets Next.js discover the env vars at startup. `.env.local` was added to `.gitignore` so the symlink cannot be committed.

### Next.js 16 proxy convention

`middleware.ts` had been accidentally deleted in an earlier commit (`c01628d` — "fix: bug fix to remove infinite pending issues in upstash"). Without it, the Supabase PKCE session cookie management was not running, causing `no valid flow state found` errors on OAuth sign-in.

Next.js 16 introduced `proxy.ts` as the successor to `middleware.ts`. A file named `proxy.ts` at the app root with a named `export async function proxy(request: NextRequest)` and `export const config` is automatically picked up by the framework — no `middleware.ts` wrapper needed. The existing `proxy.ts` was already structured correctly; re-enabling it resolved the auth flow error.

---

## Patch

All feature changes are captured in:

```
feat_associate_docs_with_auth_user.patch
```

Apply with:

```bash
git apply feat_associate_docs_with_auth_user.patch
```
