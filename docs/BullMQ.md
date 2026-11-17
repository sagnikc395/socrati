# socrati-docs
Prompt:
In the line numbers from 20-41 , as soon as your POST function returns the Response.json, the serverless runtime can freeze or terminate the entire process. If the runtime shuts down while your IIFE is still embedding chunks, your background task will simply vanish without finishing. To be replaced with BullMQ
Which file is this talking about?
Description: Currently, the ingestion pipeline (parsing, chunking, and embedding PDFs) executes inside an unmanaged background closure `(async () => {})() `in the upload API route. Vercel's serverless environment will abruptly kill this process once the request times out or returns, leading to lost data and incomplete processing. This issue implements a robust background job queue to reliably process heavy document ingestion tasks without blocking the main thread or dropping jobs.
Acceptance Criteria:

* A background job queue system (like BullMQ + Upstash Redis) is installed and configured.
* The `parsePDFFromBuffer`, `chunkDocument`, and `embedChunksStrict` function calls are moved out of the API route and into the background worker.
* The`/api/documents/upload`route only enqueues the job and immediately returns the generated `documentId` to the client.
* The worker successfully processes the document, generates embeddings, and updates the document status in the database from processing to ready upon completion.
* If the job fails, the document status is updated to failed and the error message is recorded.
Technical Notes: The project document specifies using BullMQ with Upstash Redis for async jobs. Ensure that the Redis connection string is added to the environment variables. The Next.js API route will act as the producer, while a separate worker process (or Vercel background function if deviating from BullMQ) handles the consumer logic. The UI already has Server-Sent Events (SSE) set up to listen for status changes, so the worker just needs to trigger the completion event or update the DB so the SSE route can pick it up.

Let me look at your current repo state first so I give you accurate file paths and don't conflict with anything already there.Good, I have enough context. Here's everything you need to do, in order.

---

## Step 1 — Install packages

```bash
cd apps/web
npm install bullmq @upstash/redis @upstash/ratelimit @supabase/supabase-js
```

---

## Step 2 — Add environment variables

Add these to your `.env.local` in `apps/web/`:

```
UPSTASH_REDIS_REST_URL=your_upstash_url_here
UPSTASH_REDIS_REST_TOKEN=your_upstash_token_here
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here
```

You get the Upstash values from [console.upstash.com](https://console.upstash.com) after creating a Redis database. The Supabase values are in your project's API settings.

---

## Step 3 — Add a migration for `parse_status`

Create a new file `supabase/migrations/0003_add_parse_status.sql`:

```sql
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS parse_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (parse_status IN ('pending', 'processing', 'ready', 'failed')),
ADD COLUMN IF NOT EXISTS error_message TEXT;
```

Run it against your Supabase DB:
```bash
npx supabase db push
```

---

## Step 4 — Create `apps/web/lib/redis.ts`

This is the Upstash connection (REST-based, works on Vercel):

```typescript
import { Redis } from '@upstash/redis';

export const redis = Redis.fromEnv();
```

---

## Step 5 — Create `apps/web/lib/queue.ts`

```typescript
import { Queue } from 'bullmq';

const connection = {
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
};

export const documentQueue = new Queue('document-processing', {
  connection,
});

export type DocumentJobData = {
  documentId: string;
  fileBase64: string;
  fileName: string;
  userId: string;
};
```

---

## Step 6 — Create `apps/web/lib/repository.ts`

This handles all DB writes in one place:

```typescript
import { createClient } from '@supabase/supabase-js';
import { EmbeddedChunk } from './embedder';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type ParseStatus = 'pending' | 'processing' | 'ready' | 'failed';

export async function createDocument(params: {
  id: string;
  userId: string;
  title: string;
}) {
  const { error } = await supabase.from('documents').insert({
    id: params.id,
    user_id: params.userId,
    title: params.title,
    parse_status: 'pending',
    uploaded_at: new Date().toISOString(),
  });
  if (error) throw new Error(`createDocument failed: ${error.message}`);
}

export async function updateParseStatus(
  documentId: string,
  status: ParseStatus,
  errorMessage?: string
) {
  const { error } = await supabase
    .from('documents')
    .update({ parse_status: status, error_message: errorMessage ?? null })
    .eq('id', documentId);
  if (error) throw new Error(`updateParseStatus failed: ${error.message}`);
}

export async function saveChunks(documentId: string, chunks: EmbeddedChunk[]) {
  const rows = chunks.map((chunk) => ({
    document_id: documentId,
    content: chunk.content,
    heading: chunk.heading,
    key_terms: chunk.keyTerms,
    embedding: chunk.embedding,
  }));

  const { error } = await supabase.from('document_chunks').insert(rows);
  if (error) throw new Error(`saveChunks failed: ${error.message}`);
}
```

---

## Step 7 — Create `apps/web/lib/worker.ts`

```typescript
import { Worker } from 'bullmq';
import { DocumentJobData } from './queue';
import { parsePDFFromBuffer } from './parser';
import { chunkDocument } from './chunker';
import { embedChunksStrict } from './embedder';
import { updateParseStatus, saveChunks } from './repository';
import { notifyDocumentComplete } from './waiters';

const connection = {
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
};

const worker = new Worker<DocumentJobData>(
  'document-processing',
  async (job) => {
    const { documentId, fileBase64 } = job.data;

    await updateParseStatus(documentId, 'processing');

    const buffer = Buffer.from(fileBase64, 'base64');
    const doc = await parsePDFFromBuffer(buffer);
    const chunks = await chunkDocument(doc);
    const embedded = await embedChunksStrict(chunks);

    await saveChunks(documentId, embedded);
    await updateParseStatus(documentId, 'ready');

    notifyDocumentComplete(documentId, 'ready');
    console.log(`Document ${documentId}: ${embedded.length} chunks saved`);
  },
  {
    connection,
    concurrency: 3,
  }
);

worker.on('failed', async (job, err) => {
  const documentId = job?.data?.documentId;
  console.error(`Job failed for ${documentId}:`, err.message);
  if (documentId) {
    await updateParseStatus(documentId, 'failed', err.message);
    notifyDocumentComplete(documentId, 'failed', err.message);
  }
});

console.log('Document worker started');
```

---

## Step 8 — Replace `apps/web/app/api/documents/upload/route.ts`

Replace the entire file with this:

```typescript
import { NextRequest } from 'next/server';
import { documentQueue } from '@/lib/queue';
import { createDocument } from '@/lib/repository';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    // Auth check
    const authHeader = req.headers.get('authorization');
    const token = authHeader?.replace('Bearer ', '');
    if (!token) {
      return Response.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return Response.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return Response.json({ message: 'No file provided' }, { status: 400 });
    }

    const documentId = crypto.randomUUID();

    // Create the DB row immediately so the client has a real document ID
    await createDocument({
      id: documentId,
      userId: user.id,
      title: file.name,
    });

    // Serialize file and enqueue — worker handles the rest
    const buffer = Buffer.from(await file.arrayBuffer());
    const fileBase64 = buffer.toString('base64');

    await documentQueue.add('process-document', {
      documentId,
      fileBase64,
      fileName: file.name,
      userId: user.id,
    });

    return Response.json({ documentId });

  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Upload failed';
    return Response.json({ message: msg }, { status: 500 });
  }
}
```

---

## Step 9 — Run the worker in a separate terminal

```bash
cd apps/web
npx ts-node --project tsconfig.json lib/worker.ts
```

You'll have two terminals: one running `npx turbo dev`, one running the worker.

---

That's the full set of changes. The flow is now: upload route creates DB row → enqueues job → returns `documentId`. Worker picks up the job → runs pipeline → saves chunks → updates `parse_status` to `ready` or `failed`.



### After 

Implemented the BullMQ ingestion flow.

What changed:
- Upload route now creates a document row, enqueues a BullMQ job, and returns `documentId` immediately: [route.ts](/Users/sagnikc/Desktop/Projects/Course_Projects/socrati/apps/web/app/api/documents/upload/route.ts)
- Added Redis/BullMQ setup: [redis.ts](/Users/sagnikc/Desktop/Projects/Course_Projects/socrati/apps/web/lib/redis.ts), [queue.ts](/Users/sagnikc/Desktop/Projects/Course_Projects/socrati/apps/web/lib/queue.ts)
- Added service-role DB repository for document status and chunk writes: [repository.ts](/Users/sagnikc/Desktop/Projects/Course_Projects/socrati/apps/web/lib/repository.ts)
- Added worker that runs `parsePDFFromBuffer -> chunkDocument -> embedChunksStrict`, saves chunks, and updates status: [worker.ts](/Users/sagnikc/Desktop/Projects/Course_Projects/socrati/apps/web/lib/worker.ts)
- Updated SSE to poll DB status, since a separate worker cannot notify the Next process through the old in-memory waiter map: [route.ts](/Users/sagnikc/Desktop/Projects/Course_Projects/socrati/apps/web/app/api/documents/[id]/stream/route.ts)
- Added migration for `parse_status`, `error_message`, chunk metadata, and `vector(3072)`: [0003_document_processing_queue.sql](/Users/sagnikc/Desktop/Projects/Course_Projects/socrati/supabase/migrations/0003_document_processing_queue.sql)
- Added `bullmq`, `ioredis`, `tsx`, and `npm run worker`.

Run worker with:

```bash
npm run worker -w apps/web
```

Use `REDIS_URL=rediss://...` for Upstash’s Redis URL, plus `SUPABASE_SERVICE_ROLE_KEY`.

Verification:
- `npm run check-types -w apps/web` passes.
- `npm run lint -w apps/web` passes (`--quiet`, so pre-existing warnings in the auth/session UI files do not block).
- `npm run build -w apps/web` passes: Next 16 picks up `proxy.ts` as its middleware, so no `middleware.ts` is needed alongside it.

## Bug Fix:

# Document Upload / BullMQ Synopsis

## Original Problem

The document upload route was doing heavy PDF ingestion work inside an unmanaged background closure:

```ts
(async () => {
  parse -> chunk -> embed
})();

return Response.json({ documentId });
```

That approach is unsafe in serverless environments. After the API route returns a response, the runtime can freeze or terminate the process. If that happens while parsing, chunking, or embedding is still running, the ingestion job disappears and the document never becomes ready.

## Intended Fix

Move document ingestion out of the upload API route and into a durable background queue:

1. The upload route authenticates the user.
2. The upload route creates a `documents` row with `parse_status = 'pending'`.
3. The upload route enqueues a BullMQ job.
4. The upload route immediately returns `{ documentId }`.
5. A BullMQ worker picks up the job.
6. The worker marks the document `processing`.
7. The worker parses the PDF, chunks it, embeds the chunks, and saves them.
8. The worker marks the document `ready`.
9. If anything fails, the worker marks the document `failed` and stores the error message.

## Major Code Changes

### BullMQ and Redis

Added BullMQ queue support using Redis:

- `apps/web/lib/queue.ts`
- `apps/web/lib/redis.ts`
- `apps/web/lib/worker.ts`

The queue is named:

```txt
document-processing
```

The worker processes jobs named:

```txt
process-document
```

### Upload Route

Refactored:

- `apps/web/app/api/documents/upload/route.ts`
- `apps/web/lib/document-upload.ts`

The route no longer runs parsing, chunking, or embedding inline. It now creates the document row and enqueues the job.

The upload logic was moved into `document-upload.ts` so it can be tested with mocked Supabase and queue dependencies.

### Worker

Added:

- `apps/web/lib/worker.ts`

The worker runs:

```ts
parsePDFFromBuffer -> chunkDocument -> embedChunksStrict -> saveChunksForUser
```

It updates document status as the job moves through the pipeline.

### Database Migrations

Added/updated migrations for:

- `parse_status`
- `error_message`
- chunk `heading`
- chunk `key_terms`
- 3072-dimensional embeddings
- user profile backfill

Key migration files:

- `supabase/migrations/0001_users_profile.sql`
- `supabase/migrations/0002_documents_schema.sql`
- `supabase/migrations/0003_document_processing_queue.sql`
- `supabase/migrations/0004_backfill_user_profiles.sql`

### SSE Status Stream

Updated:

- `apps/web/app/api/documents/[id]/stream/route.ts`

The SSE route now polls the database for `parse_status` instead of relying on an in-memory waiter map. This matters because the worker is a separate process and cannot reliably notify the Next.js server through shared memory.

### Queue Health

Added:

- `apps/web/app/api/documents/queue-health/route.ts`

This endpoint reports BullMQ job counts and connected worker count. It helps detect the common issue where the upload succeeds but no worker is running.

### Local Dev

Updated local development so one command starts both the Next app and the worker:

- `package.json`
- `apps/web/package.json`
- `apps/web/scripts/dev.ts`

Now this command starts the web app and BullMQ worker together:

```bash
npm run dev
```

### Environment Loading

Added:

- `apps/web/lib/load-env.ts`

The Next dev server loads env files automatically, but the standalone worker does not. The new loader makes the worker read env files from both the repo root and `apps/web`.

### Node 20 WebSocket Issue

The worker hit this Supabase error on Node 20:

```txt
Node.js 20 detected without native WebSocket support.
```

Fixed by installing `ws` and passing it to Supabase Realtime options in:

- `apps/web/lib/repository.ts`

### Tests

Added root-level tests:

- `tests/document-upload.test.ts`

Added root test script:

```bash
npm test
```

The tests cover:

- successful upload creates a pending document and enqueues a job
- unauthorized upload returns `401`
- missing file returns `400`
- queue enqueue failure marks the document failed

## Bugs Encountered and Fixes

### `parse_status` Column Missing

The app tried to write `parse_status`, but the Supabase database did not yet have that column.

Fix:

- added migration `0003_document_processing_queue.sql`
- added `notify pgrst, 'reload schema'`

### `users` Table Already Exists

Supabase migrations failed because `public.users` already existed.

Fix:

- made user migrations idempotent
- added profile backfill migration

### Foreign Key Failure on `documents.user_id`

Uploads failed because the authenticated user existed in `auth.users` but did not exist in `public.users`.

Fix:

- backfilled existing `auth.users` into `public.users`
- updated the `handle_new_user` trigger to use conflict-safe inserts

### `ivfflat` Cannot Index 3072 Dimensions

pgvector can store `vector(3072)`, but `ivfflat` cannot index vectors with more than 2000 dimensions.

Fix:

- removed the invalid `ivfflat` index from the 3072-dimensional embedding migration

### Redis Env Not Found in Worker

The worker could not see `REDIS_URL` because it was not running inside Next.js.

Fix:

- added explicit env loading for the worker

### Worker Not Running

Documents stayed stuck at:

```txt
pending
```

That meant upload worked, but the worker was not connected or not processing jobs.

Fix:

- added logs
- added queue health endpoint
- made `npm run dev` start the worker automatically

### Supabase WebSocket Error on Node 20

Supabase client creation failed inside the worker because Node 20 does not provide native WebSocket support.

Fix:

- installed `ws`
- passed it into Supabase client realtime options

## Current Status

The implementation is now structurally fixed:

- Upload route no longer does heavy ingestion inline.
- BullMQ queue exists.
- Worker exists and starts with `npm run dev`.
- Redis env loading is handled for the worker.
- Supabase Node 20 WebSocket issue is handled.
- SSE polls the database for status.
- Queue health endpoint exists.
- Tests exist for the upload handler.
- Type-check and production build have passed.

## Did We Fix It?

Yes, the original architectural bug was fixed.

The upload route no longer relies on an unmanaged background closure that can be killed after the response returns. Document ingestion now runs through BullMQ and a separate worker.

However, the system still depends on the external services being configured correctly:

- Supabase migrations must be applied.
- `REDIS_URL` must point to the Upstash Redis protocol URL, not the REST URL.
- `npm run dev` must be used so the worker starts with the app.
- For real embeddings, `GEMINI_API_KEY` must be set.
- For local testing without Gemini, `EMBEDDING_MOCK=true` can be used.

So the core bug is fixed, but upload success still depends on valid database schema, Redis connectivity, and embedding configuration.

## Useful Commands

Run the app and worker together:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

Check types:

```bash
npm run check-types -w apps/web
```

Build:

```bash
npm run build -w apps/web
```

Check queue health:

```txt
http://localhost:3000/api/documents/queue-health
```
