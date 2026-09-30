'use client';

import React, { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { z } from 'zod';
import { signupSchema, loginSchema, type SignupFormData, type LoginFormData } from '@/lib/schemas/auth';

export default function AuthPage() {
    return (
        <Suspense>
            <AuthContent />
        </Suspense>
    );
}

function AuthContent() {
    const [tab, setTab] = useState<'login' | 'signup'>('login');
    const searchParams = useSearchParams();
    const urlError = searchParams.get('error');

    return (
        <div style={{
            minHeight: '100vh',
            background: 'var(--main)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
        }}>
            <div style={{
                display: 'flex',
                borderRadius: 16,
                overflow: 'hidden',
                border: '1px solid var(--b1)',
                boxShadow: '0 1px 8px rgba(30,40,32,.06)',
                width: '100%',
                maxWidth: 780,
            }}>
                {/* Left panel */}
                <div style={{
                    width: 230,
                    background: 'var(--sb)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    padding: '28px 24px',
                    borderRight: '1px solid var(--sb1)',
                    flexShrink: 0,
                }}>
                    <div>
                        <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--td)', letterSpacing: '-0.3px' }}>
                            Socra<em style={{ color: 'var(--acc)', fontStyle: 'italic', fontWeight: 500 }}>ti</em>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 4 }}>
                            AI-powered Socratic tutor
                        </div>
                    </div>
                    <div>
                        <div style={{ fontSize: 14, fontStyle: 'italic', fontWeight: 400, color: 'var(--t1)', lineHeight: 1.75 }}>
                            &ldquo;Tell me and I forget. Teach me and I remember. Involve me and I learn.&rdquo;
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 9 }}>— Benjamin Franklin</div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--t3)' }}>
                        UMass · Five College Community
                    </div>
                </div>

                {/* Right panel */}
                <div style={{
                    flex: 1,
                    background: 'var(--main)',
                    padding: '32px 28px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                }}>
                    {urlError && (
                        <ErrorBanner message={decodeURIComponent(urlError)} style={{ marginBottom: 16 }} />
                    )}

                    {/* Tabs */}
                    <div style={{ display: 'flex', borderBottom: '1px solid var(--b1)', marginBottom: 24 }}>
                        {(['login', 'signup'] as const).map((t, i) => (
                            <button
                                key={t}
                                onClick={() => setTab(t)}
                                style={{
                                    fontSize: 13,
                                    padding: '7px 16px 10px',
                                    cursor: 'pointer',
                                    color: tab === t ? 'var(--acc)' : 'var(--t3)',
                                    borderBottom: tab === t ? '2px solid var(--acc)' : '2px solid transparent',
                                    marginBottom: -1,
                                    fontFamily: 'inherit',
                                    fontWeight: tab === t ? 500 : 400,
                                    background: 'transparent',
                                    border: 'none',
                                }}
                            >
                                {i === 0 ? 'Sign in' : 'Create account'}
                            </button>
                        ))}
                    </div>

                    {tab === 'login' ? <LoginForm /> : <SignupForm />}
                </div>
            </div>
        </div>
    );
}

// ── Error helpers ────────────────────────────────────────────────────────────

function friendlyAuthError(message: string): string {
    const m = message.toLowerCase();
    if (m.includes('user already registered') || m.includes('already been registered'))
        return 'An account with this email already exists. Try signing in instead.';
    if (m.includes('invalid login credentials') || m.includes('invalid credentials'))
        return 'Incorrect email or password.';
    if (m.includes('email not confirmed'))
        return 'Please confirm your email address before signing in. Check your inbox.';
    if (m.includes('rate limit') || m.includes('too many requests') || m.includes('over_email_send_rate_limit'))
        return 'Too many attempts. Please wait a moment and try again.';
    if (m.includes('signup_disabled'))
        return 'Registration is temporarily unavailable. Please try again later.';
    if (m.includes('network') || m.includes('fetch'))
        return 'Network error. Check your connection and try again.';
    return message;
}

// ── Login ────────────────────────────────────────────────────────────────────

function LoginForm() {
    const [values, setValues] = useState<LoginFormData>({ email: '', password: '' });
    const [fieldErrors, setFieldErrors] = useState<Partial<LoginFormData>>({});
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const set = (k: keyof LoginFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setValues(v => ({ ...v, [k]: e.target.value }));
        setFieldErrors(fe => ({ ...fe, [k]: undefined }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitError(null);

        const result = loginSchema.safeParse(values);
        if (!result.success) {
            const flat = z.flattenError(result.error).fieldErrors;
            setFieldErrors({ email: flat.email?.[0], password: flat.password?.[0] });
            return;
        }

        setLoading(true);
        const supabase = createClient();
        const { error } = await supabase.auth.signInWithPassword(result.data);

        if (error) {
            setSubmitError(friendlyAuthError(error.message));
            setLoading(false);
            return;
        }

        router.push('/session/new');
        router.refresh();
    };

    return (
        <form onSubmit={handleSubmit} noValidate>
            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--td)', marginBottom: 4, letterSpacing: '-0.2px' }}>
                Welcome back
            </div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 20 }}>
                Sign in with your institutional email
            </div>
            {submitError && <ErrorBanner message={submitError} />}
            <Field label="Email" error={fieldErrors.email}>
                <input
                    type="email"
                    placeholder="you@umass.edu"
                    value={values.email}
                    onChange={set('email')}
                    autoComplete="email"
                />
            </Field>
            <Field label="Password" error={fieldErrors.password}>
                <input
                    type="password"
                    placeholder="••••••••"
                    value={values.password}
                    onChange={set('password')}
                    autoComplete="current-password"
                />
            </Field>
            <SubmitBtn loading={loading}>Sign in</SubmitBtn>
            <Divider />
            <GoogleBtn />
        </form>
    );
}

// ── Signup ───────────────────────────────────────────────────────────────────

function SignupForm() {
    const [values, setValues] = useState<SignupFormData>({ name: '', email: '', password: '' });
    const [fieldErrors, setFieldErrors] = useState<Partial<SignupFormData>>({});
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    const set = (k: keyof SignupFormData) => (e: React.ChangeEvent<HTMLInputElement>) => {
        setValues(v => ({ ...v, [k]: e.target.value }));
        setFieldErrors(fe => ({ ...fe, [k]: undefined }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitError(null);

        const result = signupSchema.safeParse(values);
        if (!result.success) {
            const flat = z.flattenError(result.error).fieldErrors;
            setFieldErrors({
                name: flat.name?.[0],
                email: flat.email?.[0],
                password: flat.password?.[0],
            });
            return;
        }

        setLoading(true);
        const supabase = createClient();
        const { data, error } = await supabase.auth.signUp({
            email: result.data.email,
            password: result.data.password,
            options: {
                data: { name: result.data.name },
                emailRedirectTo: `${window.location.origin}/auth/callback`,
            },
        });

        if (error) {
            setSubmitError(friendlyAuthError(error.message));
            setLoading(false);
            return;
        }

        // session is null when email confirmation is required (Supabase default)
        if (data.session) {
            router.push('/session/new');
        } else {
            router.push('/auth/verify-email');
        }
    };

    return (
        <form onSubmit={handleSubmit} noValidate>
            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--td)', marginBottom: 4, letterSpacing: '-0.2px' }}>
                Create account
            </div>
            <div style={{ fontSize: 12, color: 'var(--t3)', marginBottom: 20 }}>
                Join with your institutional email
            </div>
            {submitError && <ErrorBanner message={submitError} />}
            <Field label="Full name" error={fieldErrors.name}>
                <input
                    type="text"
                    placeholder="Your name"
                    value={values.name}
                    onChange={set('name')}
                    autoComplete="name"
                />
            </Field>
            <Field
                label="Email"
                error={fieldErrors.email}
                note={!fieldErrors.email ? 'Must be a @umass.edu address' : undefined}
            >
                <input
                    type="email"
                    placeholder="you@umass.edu"
                    value={values.email}
                    onChange={set('email')}
                    autoComplete="email"
                />
            </Field>
            <Field label="Password" error={fieldErrors.password}>
                <input
                    type="password"
                    placeholder="Min 8 chars, one uppercase, one number"
                    value={values.password}
                    onChange={set('password')}
                    autoComplete="new-password"
                />
            </Field>
            <SubmitBtn loading={loading}>Create account</SubmitBtn>
            <Divider />
            <GoogleBtn />
        </form>
    );
}

// ── Shared UI ────────────────────────────────────────────────────────────────

function GoogleBtn() {
    const handleGoogle = async () => {
        const supabase = createClient();
        await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: { redirectTo: `${window.location.origin}/auth/callback` },
        });
    };

    return (
        <button
            type="button"
            onClick={handleGoogle}
            style={{
                width: '100%', height: 38, background: 'var(--card)',
                border: '1px solid var(--b1)', borderRadius: 9,
                fontFamily: 'inherit', fontSize: 12, color: 'var(--t1)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            }}
        >
            <svg width="14" height="14" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
        </button>
    );
}

function Field({ label, note, error, children }: {
    label: string;
    note?: string;
    error?: string;
    children: React.ReactNode;
}) {
    return (
        <div style={{ marginBottom: 13 }}>
            <label style={{ fontSize: 11, color: 'var(--t2)', display: 'block', marginBottom: 4, fontWeight: 500 }}>
                {label}
            </label>
            <style>{`
        .auth-input {
          width: 100%; height: 38px; padding: 0 12px;
          border: 1px solid var(--b1); border-radius: 8px;
          font-family: inherit; font-size: 13px;
          background: var(--card); color: var(--td); outline: none;
          box-sizing: border-box;
        }
        .auth-input:focus { border-color: var(--acc); }
        .auth-input.input-error { border-color: #e05c4a; background: #fff9f8; }
      `}</style>
            <div style={{ display: 'contents' }}>
                {React.cloneElement(children as React.ReactElement<{ className?: string }>, {
                    className: `auth-input${error ? ' input-error' : ''}`,
                })}
            </div>
            {error
                ? <div style={{ fontSize: 10, color: '#c0392b', marginTop: 3 }}>{error}</div>
                : note && <div style={{ fontSize: 10, color: 'var(--t3)', marginTop: 3 }}>{note}</div>
            }
        </div>
    );
}

function ErrorBanner({ message, style: extraStyle }: { message: string; style?: React.CSSProperties }) {
    return (
        <div style={{
            background: '#fef0ee', border: '1px solid #f5c6c0',
            borderRadius: 8, padding: '9px 12px',
            fontSize: 12, color: '#7a2a22', marginBottom: 14,
            ...extraStyle,
        }}>
            {message}
        </div>
    );
}

function SubmitBtn({ loading, children }: { loading: boolean; children: React.ReactNode }) {
    return (
        <button
            type="submit"
            disabled={loading}
            style={{
                width: '100%', height: 40,
                background: loading ? 'var(--acc1)' : 'var(--acc)',
                color: '#eef8f2', border: 'none', borderRadius: 9,
                fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                cursor: loading ? 'not-allowed' : 'pointer',
                marginTop: 4, transition: 'background 0.15s',
            }}
        >
            {loading ? 'Loading...' : children}
        </button>
    );
}

function Divider() {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--b1)' }} />
            <div style={{ fontSize: 11, color: 'var(--t3)' }}>or</div>
            <div style={{ flex: 1, height: 1, background: 'var(--b1)' }} />
        </div>
    );
}
