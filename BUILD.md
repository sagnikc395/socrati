# BUILD.md

## Prerequisites

| Tool    | Version |
| ------- | ------- |
| Node.js | ≥ 20    |
| npm     | ≥ 11    |

## Environment variables

Copy the template below into `.env` at the repo root and into
`apps/web/.env.local`.

```env
# Redis (Upstash)
REDIS_URL="rediss://default:<password>@<host>.upstash.io:6379"
UPSTASH_REDIS_REST_URL="https://<host>.upstash.io"
UPSTASH_REDIS_REST_TOKEN="<token>"

# Supabase
NEXT_PUBLIC_SUPABASE_URL="https://<project>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon-key>"
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
# Drizzle / worker writes: Supabase Transaction pooler URL (port 6543)
DATABASE_URL="postgresql://postgres.<ref>:<password>@<host>:6543/postgres"

# Google OAuth
OAUTH_CLIENT_ID="<client-id>.apps.googleusercontent.com"
OAUTH_CLIENT_SECRET="<client-secret>"

# AI Providers
GEMINI_API_KEY="<gemini-api-key>"
GROQ_API_KEY="<groq-api-key>"
TAVILY_API_KEY="<tavily-api-key>"

# Optional
# DOCUMENT_WORKER_CONCURRENCY=5
# VOICE_WORKER_CONCURRENCY=2
# EMBEDDING_MOCK=true
```

## Installation

```bash
git clone <repo-url>
cd socrati
npm install
```

## Database setup

Apply all Supabase migrations using the Supabase CLI:

```bash
npx supabase db push
```

### Schema changes (Drizzle)

`apps/web/lib/db/schema.ts` is the typed source of truth for the database.
Edit it, then generate the migration from it:

```bash
npm run db:generate  # diff schema.ts → new file in supabase/migrations/
npm run db:push      # apply directly to a local dev database
npm run db:studio    # browse data
```

Both `db:generate` and `db:push` read `DATABASE_URL` from `apps/web/.env.local`.

## Development

Starts the Next.js dev server and the BullMQ worker concurrently:

```bash
npm run dev
```

The app is available at `http://localhost:3000`.

To run them separately:

```bash
npm run dev:next --workspace=web   # Next.js only
npm run worker --workspace=web     # worker only
```

### Voice mode

Recording runs through the same worker process as document ingestion
(`voice-processing` queue). The flow is:

```text
browser MediaRecorder → POST /api/voice → Storage bucket + voice_turns (pending)
→ worker: Groq Whisper → retrieveContext → Socratic reply
→ messages + voice_turns ready → client polls GET /api/voice/:id
```

- Migration `0013_voice_turns.sql` creates the `voice_turns` table and the
  private `voice-recordings` Storage bucket with owner-scoped policies.
- Transcription uses Whisper (`whisper-large-v3-turbo`) through the existing
  `GROQ_API_KEY`, so voice mode needs no new secrets. The worker needs
  `SUPABASE_SERVICE_ROLE_KEY` to read and delete audio.
- Caps: 10 MB and 120 s per clip, an audio mime allowlist, and 10 uploads per
  minute per user.
- Raw audio is deleted after transcription. The transcript and reply are what
  persist.

## Build

```bash
npm run build
```

## Production

```bash
npm run build
npm run start --workspace=web    # web server
npm run worker --workspace=web   # worker (run alongside)
```

## Code quality

```bash
npm run check-types   # type check
npm run lint          # lint (errors fail; warnings don't)
npm run format        # format with Prettier
```

## Tests

```bash
npm test               # run all tests
npm run test:coverage  # run with coverage
```

Set `EMBEDDING_MOCK=true` to skip real embedding API calls during tests.

### Socratic eval

The eval sends sample questions through the tutor and scores the replies with a
Groq LLM judge, checking that the tutor asks questions instead of giving
answers. It needs a real `GROQ_API_KEY`:

```bash
npm run eval               # writes eval/last-run.json
npm run eval:check         # fails if the run regressed vs. eval/baseline.json
npm run eval:update-baseline  # bless the latest run as the new baseline (review first)
```

`eval/baseline.json` is committed and gates CI, so run `npm run eval` then
`npm run eval:update-baseline` once after install and commit the result.

The committed `.env.test` file provides mock values for CI and local test runs. Do not put real service credentials in `.env.test`; use `.env` and `.env.local` for local development secrets.

## CI/CD

GitHub Actions runs `.github/workflows/ci-cd.yml` on every pull request to `main` and on every push to `main`.

Pull request checks run:

```bash
npm exec --workspace=web -- eslint --quiet
npm exec --workspace=@repo/ui -- eslint . --quiet
npm run check-types
npm test
```

The workflow also runs the Socratic eval (`npm run eval && npm run eval:check`).
That step needs the `GROQ_API_KEY` repository secret and a committed
`eval/baseline.json`.

`npm test` uses Node's built-in test runner, not Jest. CI lint runs ESLint directly in quiet mode so existing warnings are not treated as deployment blockers, while ESLint errors still fail the check.

Configure these GitHub Actions repository secrets before enabling deployment:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
GEMINI_API_KEY
GROQ_API_KEY
VERCEL_TOKEN
VERCEL_ORG_ID
VERCEL_PROJECT_ID
```

To block merges when checks fail, enable branch protection for `main` in GitHub and require the `Lint, type-check, and test` status check.

On push to `main`, the workflow deploys the linked Vercel project to production with `amondnet/vercel-action`. Keep the Vercel project Root Directory set to `apps/web`; the GitHub Action runs from the repository root so Vercel does not resolve the path twice.
