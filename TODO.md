# TODO

Deployment work is finished in code; what remains needs your accounts and
credentials. `npm test`, `npm run lint`, `npm run check-types`, and
`npm run build` all pass, and the auth routes were smoke-tested against a
production build.

## 1. Supabase (blocks sign-in)

- [ ] Create the Supabase project and link it: `npx supabase link --project-ref <ref>`
- [ ] Apply migrations: `npx supabase db push`
- [ ] Authentication → URL Configuration → **Site URL** = `https://<your-domain>`
- [ ] Add `https://<your-domain>/auth/callback` to **Redirect URLs**
  (keep `http://localhost:3000/auth/callback` for local work)
- [ ] Enable **Authentication → Providers → Google** with a Google OAuth client
- [ ] Add `https://<ref>.supabase.co/auth/v1/callback` as an authorized redirect
  URI in the Google Cloud console
- [ ] Decide whether email confirmation stays on. If it does, confirm the
  confirmation template points at `{{ .SiteURL }}/auth/callback`

## 2. Vercel (web app)

- [ ] Import the repo and set **Root Directory** to `apps/web`
- [ ] Add env vars: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `REDIS_URL`,
  `GEMINI_API_KEY`, `GROQ_API_KEY`, `TAVILY_API_KEY`
- [ ] Set `NEXT_PUBLIC_SITE_URL` to the real domain — left unset, every OAuth
  callback redirects to `http://localhost:3000`

## 3. Worker (not deployable on Vercel)

- [ ] Provision a Redis with a `rediss://` URL (Upstash works; the REST
  URL/token pair does not)
- [ ] Deploy the root `Dockerfile` to an always-on host (Fly, Railway, Render, VM)
- [ ] Pass `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `DATABASE_URL`, `REDIS_URL`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `TAVILY_API_KEY`
- [ ] Keep it at a minimum of one replica; an idle worker is what moves uploads
  to `ready`

## 4. GitHub Actions

- [ ] Add repo secrets: `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `REDIS_URL`, `GEMINI_API_KEY`, `GROQ_API_KEY`,
  `TAVILY_API_KEY`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
- [ ] Enable branch protection on `main` requiring the
  `Lint, type-check, and test` check

## 5. Verify in production

- [ ] `/` redirects to `/auth`
- [ ] Email + password signup with a `@umass.edu` address reaches `/session/new`
- [ ] Sign out, sign back in with email + password
- [ ] Sign in with Google (the flow that fails most often — see the redirect
  URLs above)
- [ ] A non-`@umass.edu` Google account lands on `/auth/restricted`
- [ ] Upload a PDF and watch it reach `ready`; stuck at `pending` means the
  worker is down or cannot reach Redis
- [ ] Send a chat message and confirm a streamed Socratic reply
- [ ] Record a voice question and confirm the transcript and reply persist

## 6. Known gaps (not fixed)

- [ ] Unauthenticated `/api/*` requests get a 307 redirect to `/auth` instead of
  a 401, because `apps/web/proxy.ts` matches API routes. The handlers return 401
  themselves; the proxy redirect only matters for callers that follow redirects.
- [ ] No automated test boots the production server to assert the auth
  redirects; the check is manual today.
- [ ] The worker image is not built or published by CI — releasing worker changes
  is a manual step.
- [ ] `apps/web/lib/supabase/domains.ts` allows only `umass.edu`, while the signup
  form copy says "UMass or Five College address".
- [ ] A real sign-in, the confirmation-email round trip, and a live Google OAuth
  redirect have not been exercised — there are no production credentials in the
  repo.
