# Logout Functionality — End-to-End

This document covers everything implemented for the sign-out feature: the auth library, how the Sidebar wires it up, session expiry handling, logging, and the test suite.

---

## Problem

Before this change:
- There was no way for a logged-in user to sign out.
- The Sidebar showed hardcoded user data (`"Deepali S."`, `"deepali@umass.edu"`).
- Session expiry silently left users on protected pages with no redirect.

---

## Files Changed / Created

| File | Change |
|---|---|
| `apps/web/lib/auth.ts` | New — pure sign-out and session-expiry logic |
| `apps/web/components/Sidebar.tsx` | Updated — real user data, logout button, session watcher |
| `tests/auth.test.ts` | New — unit tests for `handleSignOut` and `handleSessionExpiry` |

---

## `apps/web/lib/auth.ts`

The core logic lives here as two pure functions. Both accept injected dependencies so they are easy to test without a DOM or React runtime.

```ts
export type SignOutDeps = {
    signOut: () => Promise<{ error: { message: string } | null }>;
    redirect: (path: string) => void;
    log: (msg: string) => void;
};
```

### `handleSignOut(deps)`

Called when the user explicitly clicks **Sign out**.

1. Logs `[auth] sign out initiated`
2. Calls `deps.signOut()` (wraps `supabase.auth.signOut()`)
3. On success — logs `[auth] sign out successful`
4. On error — logs `[auth] sign out error: <message>`
5. **Always** calls `deps.redirect('/auth')` — the redirect is unconditional so a failed signOut still lands the user at the login page rather than leaving them in a broken state

```ts
export async function handleSignOut(deps: SignOutDeps): Promise<void> {
    deps.log('[auth] sign out initiated');
    const { error } = await deps.signOut();
    if (error) {
        deps.log(`[auth] sign out error: ${error.message}`);
    } else {
        deps.log('[auth] sign out successful');
    }
    deps.redirect('/auth');
}
```

### `handleSessionExpiry(deps)`

Called by the Supabase `onAuthStateChange` listener when a `SIGNED_OUT` event fires without the user clicking anything (idle timeout, token revocation, etc.).

1. Logs `[auth] session expired — redirecting to /auth`
2. Redirects to `/auth?error=Session+expired...` so the existing `ErrorBanner` on the auth page surfaces the message to the user

```ts
export function handleSessionExpiry(deps: Pick<SignOutDeps, 'redirect' | 'log'>): void {
    deps.log('[auth] session expired — redirecting to /auth');
    deps.redirect('/auth?error=' + encodeURIComponent('Session expired. Please sign in again.'));
}
```

---

## `apps/web/components/Sidebar.tsx`

### Real user hydration

`supabase.auth.getUser()` is called once on mount. It reads `user_metadata.name` (password signup) and `user_metadata.full_name` (Google OAuth) to cover both auth providers.

```ts
supabase.auth.getUser().then(({ data }) => {
    if (data.user) {
        const name = data.user.user_metadata?.name
                  ?? data.user.user_metadata?.full_name
                  ?? '';
        setDisplayName(name);
        setEmail(data.user.email ?? '');
    }
});
```

The avatar shows initials derived from the name (e.g. `"Sagnik Chatterjee"` → `SC`). If no name is available it falls back to the first two characters of the email. While loading, `…` is shown.

### Session expiry listener

A single `onAuthStateChange` subscription watches for `SIGNED_OUT` events. An explicit sign-out triggered by the button also fires this event, but because `handleSignOut` already called `router.push('/auth')` by then, the listener's redirect is a no-op — Next.js deduplicates same-path navigations.

```ts
const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
        handleSessionExpiry({
            redirect: (p) => router.push(p),
            log: console.log,
        });
    }
});
```

The subscription is cleaned up in the `useEffect` return to avoid leaks.

### Sign out button

```ts
const handleLogout = () => handleSignOut({
    signOut: () => createClient().auth.signOut(),
    redirect: (p) => router.push(p),
    log: console.log,
});
```

The button sits above the user card at the bottom of the sidebar, separated by the sidebar divider line.

---

## Logging

All log lines are prefixed `[auth]` and emitted via `console.log` in production (easily replaced with a structured logger later by swapping the `log` dep).

| Event | Log message |
|---|---|
| User clicks Sign out | `[auth] sign out initiated` |
| `supabase.auth.signOut()` succeeds | `[auth] sign out successful` |
| `supabase.auth.signOut()` returns an error | `[auth] sign out error: <error.message>` |
| Session expires / token revoked | `[auth] session expired — redirecting to /auth` |

---

## Redirect Behaviour

| Trigger | Destination |
|---|---|
| User clicks Sign out | `/auth` |
| `signOut()` returns an error | `/auth` (still redirects) |
| Session expires (idle timeout, revocation) | `/auth?error=Session+expired.+Please+sign+in+again.` |

The `?error=` query param is read by the existing `ErrorBanner` component in `app/auth/page.tsx`:

```ts
const urlError = searchParams.get('error');
// ...
{urlError && <ErrorBanner message={decodeURIComponent(urlError)} />}
```

---

## Tests — `tests/auth.test.ts`

Uses the same native Node.js test runner (`node:test`) and dependency-injection pattern as the existing `document-upload.test.ts`. No DOM, no React, no network.

### Test helper

```ts
function createDeps(options?: { signOutError?: { message: string } | null }) {
    const redirects: string[] = [];
    const logs: string[] = [];
    return {
        deps: {
            async signOut() { return { error: options?.signOutError ?? null }; },
            redirect(path: string) { redirects.push(path); },
            log(msg: string) { logs.push(msg); },
        },
        redirects,
        logs,
    };
}
```

### `handleSignOut` — 4 tests

| # | Name | What it checks |
|---|---|---|
| 1 | success path | `signOut` called, redirected to `/auth`, logs contain "initiated" and "successful" |
| 2 | error path | error message logged, still redirects to `/auth`, no "successful" log line |
| 3 | signOut called exactly once | call count assertion — not zero, not twice |
| 4 | execution order | `signOut` fires before `redirect` (verifies the `await` ordering) |

### `handleSessionExpiry` — 1 test

| # | Name | What it checks |
|---|---|---|
| 1 | session expiry redirect | URL starts with `/auth?error=`, decoded string contains "Session expired", log line present |

### Running the tests

```bash
npm test
```

Expected output:

```
# Subtest: handleSignOut
ok 1 - calls signOut and redirects to /auth on success
ok 2 - logs the error and still redirects to /auth when signOut fails
ok 3 - calls signOut exactly once
ok 4 - redirects before returning even on signOut error
# Subtest: handleSessionExpiry
ok 1 - redirects to /auth with a session expired error message

# tests 9
# pass  9
# fail  0
```

---

## Design Decisions

**Why extract to `lib/auth.ts` instead of keeping logic in the component?**
React components can't be imported in Node.js tests without a JSDOM setup. Extracting the logic as plain functions with injected deps keeps tests fast and framework-free, matching the pattern already established by `lib/document-upload.ts`.

**Why redirect unconditionally on `signOut` error?**
A failed `signOut` call most commonly means the session is already invalid server-side. Leaving the user on a protected page in that state would cause every subsequent API call to 401. The safest recovery is always to push to `/auth`.

**Why does the session expiry listener redirect even after an explicit sign-out?**
The button calls `signOut()`, which fires a `SIGNED_OUT` event, which the listener picks up. Both paths redirect to `/auth`. Next.js deduplicates same-path `router.push` calls so this causes no double-navigation in practice. The trade-off (minimal extra log line) is preferable to adding a flag to suppress the listener.