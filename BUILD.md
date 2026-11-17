# BUILD.md

## Prerequisites

| Tool    | Version |
| ------- | ------- |
| Node.js | ≥ 20    |
| npm     | ≥ 11    |

## Environment variables

Copy `.env.example` to `.env` at the repo root and fill in the values:

```bash
cp .env.example .env
```

`loadEnvFiles()` reads, in order, `<root>/.env`, `<root>/.env.local`,
`apps/web/.env`, `apps/web/.env.local`; the first value set for a key wins. A
single root `.env` is enough for both the web app and the worker.

The full template:

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

# OAuth redirect target — /auth/callback builds its redirect origin from this.
# Defaults to http://localhost:3000 when unset; set it in deployed environments.
NEXT_PUBLIC_SITE_URL="http://localhost:3000"

# Google OAuth — configured in the Supabase dashboard
# (Authentication -> Providers -> Google), NOT read by the application code.
# Only needed if you wire the provider up via the Supabase CLI / config.toml.
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

`drizzle.config.ts` resolves `DATABASE_URL` through the same `loadEnvFiles()`
search path as the rest of the project, so the root `.env` is picked up. If
`DATABASE_URL` is unset, drizzle-kit falls back to
`postgresql://localhost:5432/postgres` instead of reporting an error — if a push
appears to hang or cannot see your tables, check that `DATABASE_URL` is set.

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

`next.config.ts` calls `loadEnvFiles()`, so a self-hosted `next start` reads the
repo-root `.env` exactly like `npm run dev` does. Variables that are already set
in the process environment (Vercel, Docker, CI) take precedence.

## Deployment

Two long-running processes plus two managed services:

| Piece | Where | Why there |
| --- | --- | --- |
| Next.js app | Vercel | stateless request handling |
| BullMQ worker | any always-on container host (Fly.io, Railway, Render, a VM) | consumes Redis queues; serverless functions cannot stay alive for it |
| Postgres, Auth, Storage | Supabase | `supabase/migrations` is the schema |
| Redis | Upstash or any Redis with a `rediss://` URL | BullMQ queues + chat rate limiting |

### 1. Supabase project

Create the project, then push the migrations against it:

```bash
npx supabase link --project-ref <ref>
npx supabase db push
```

Under **Authentication → URL Configuration** set:

- **Site URL**: `https://<your-domain>`
- **Redirect URLs**: `https://<your-domain>/auth/callback`

Both are required. `/auth/callback` sends unlisted redirect targets back to the
Site URL, and a missing entry produces `no valid flow state found` after Google
sign-in. Keep `http://localhost:3000/auth/callback` in the list for local work.

For Google sign-in, enable **Authentication → Providers → Google** and add
`https://<ref>.supabase.co/auth/v1/callback` as an authorized redirect URI in
the Google Cloud console. `/auth` also supports email + password signup, whose
confirmation link points at `/auth/callback`.

Signups are restricted to the domains in `apps/web/lib/supabase/domains.ts`
(`umass.edu`); OAuth accounts from other domains are signed out and sent to
`/auth/restricted`.

### 2. Vercel

Import the repo, set **Root Directory** to `apps/web`, and add these environment
variables for Production (and Preview, if you want previews to work):

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_SITE_URL       # https://<your-domain> — without it OAuth returns to localhost:3000
REDIS_URL                  # rediss://… (BullMQ URL, not the Upstash REST pair)
GEMINI_API_KEY
GROQ_API_KEY
TAVILY_API_KEY
```

`NEXT_PUBLIC_SITE_URL` is read at request time by `/auth/callback` to build the
post-login redirect. Leave it unset and every sign-in lands on
`http://localhost:3000`.

### 3. Worker

The repo root has a `Dockerfile` for the worker:

```bash
docker build -t socrati-worker .
docker run --env-file .env socrati-worker
```

Any host that can run a container works. The worker needs:

```text
NEXT_PUBLIC_SUPABASE_URL      SUPABASE_SERVICE_ROLE_KEY
DATABASE_URL                  REDIS_URL
GEMINI_API_KEY                GROQ_API_KEY
TAVILY_API_KEY
```

It writes chunks through Drizzle (`DATABASE_URL`, Supabase pooler port 6543) and
reads/deletes audio in the private voice bucket through the service-role key. Do
not scale it to zero: an idle worker is what makes uploads reach `ready`.

### 4. Verify the deployment

1. `https://<your-domain>` redirects to `/auth`.
2. Create an account with a `@umass.edu` address; the confirmation link returns
to `/auth/callback` and lands on `/session/new`.
3. Sign out, sign back in with email + password, then once with Google.
4. Upload a PDF and watch it reach `ready` — if it stays `pending`, the worker is
not running or cannot reach Redis.
5. Send a chat message; a 429 means Redis rate limiting is working, a 500 with
`DATABASE_URL is missing` means the worker's env is incomplete.

### GitHub Actions deploy

The workflow deploys through Vercel on push to `main`. Besides the Vercel
token/org/project IDs it needs the repository secrets `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `GEMINI_API_KEY`, `GROQ_API_KEY`, and
`TAVILY_API_KEY`. The worker is not deployed by this workflow — release it to its
container host separately when worker code changes.

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
