# BUILD.md

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| npm | ≥ 11 |

---

## Environment Variables

Copy the template below to **both** `.env` (repo root) and `apps/web/.env.local`.

```env
# Redis (Upstash)
REDIS_URL="rediss://default:<password>@<host>.upstash.io:6379"
UPSTASH_REDIS_REST_URL="https://<host>.upstash.io"
UPSTASH_REDIS_REST_TOKEN="<token>"

# Supabase
NEXT_PUBLIC_SUPABASE_URL="https://<project>.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="<anon-key>"
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"

# Google OAuth
OAUTH_CLIENT_ID="<client-id>.apps.googleusercontent.com"
OAUTH_CLIENT_SECRET="<client-secret>"

# AI Providers
GEMINI_API_KEY="<gemini-api-key>"
GROQ_API_KEY="<groq-api-key>"
TAVILY_API_KEY="<tavily-api-key>"

# Optional
# DOCUMENT_WORKER_CONCURRENCY=5
# EMBEDDING_MOCK=true
```

---

## Installation

```bash
git clone <repo-url>
cd socrati
npm install
```

---

## Database Setup

Apply all Supabase migrations using the Supabase CLI:

```bash
npx supabase db push
```

---

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

---

## Build

```bash
npm run build
```

---

## Production

```bash
npm run build
npm run start --workspace=web    # web server
npm run worker --workspace=web   # worker (run alongside)
```

---

## Code Quality

```bash
npm run check-types   # type check
npm run lint          # lint (zero warnings enforced)
npm run format        # format with Prettier
```

---

## Tests

```bash
npm test               # run all tests
npm run test:coverage  # run with coverage
```

Set `EMBEDDING_MOCK=true` to skip real embedding API calls during tests.

The committed `.env.test` file provides mock values for CI and local test runs. Do not put real service credentials in `.env.test`; use `.env` and `.env.local` for local development secrets.

---

## CI/CD

GitHub Actions runs `.github/workflows/ci-cd.yml` on every pull request to `main` and on every push to `main`.

Pull request checks run:

```bash
npm exec --workspace=web -- eslint --quiet
npm exec --workspace=@repo/ui -- eslint . --quiet
npm run check-types
npm test
```

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
