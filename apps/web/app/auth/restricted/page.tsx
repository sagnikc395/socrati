'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { AuthPanel } from '@/components/AuthPanel';

const DOMAINS = ['@umass.edu', '@smith.edu', '@hampshire.edu', '@mtholyoke.edu', '@amherst.edu'];

export default function RestrictedPage() {
    const router = useRouter();

    const handleSignOut = async () => {
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push('/auth');
    };

    return (
        <AuthPanel quote="The roots of education are bitter, but the fruit is sweet." author="Aristotle">
            <div
                style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: '#fef0ee',
                    border: '1px solid #f5c6c0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 20,
                }}
            >
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                    <path d="M11 7v5M11 15h.01" stroke="#c0392b" strokeWidth="1.8" strokeLinecap="round" />
                    <circle cx="11" cy="11" r="9" stroke="#c0392b" strokeWidth="1.5" />
                </svg>
            </div>

            <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--td)', letterSpacing: '-0.2px', marginBottom: 8 }}>
                Access restricted
            </div>
            <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.7, marginBottom: 24, maxWidth: 340 }}>
                Socrati is only available to students and faculty at UMass Amherst and the Five College consortium.
                Please sign in with an institutional email address.
            </div>

            <div className="hint-box" style={{ marginBottom: 28 }}>
                <div className="overline" style={{ marginBottom: 8, letterSpacing: '.04em' }}>
                    Accepted domains
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {DOMAINS.map(d => (
                        <span key={d} className="badge" style={{ background: 'var(--acl)', color: '#2a5c38' }}>
                            {d}
                        </span>
                    ))}
                </div>
            </div>

            <button onClick={handleSignOut} className="btn btn-primary" style={{ alignSelf: 'flex-start' }}>
                Sign in with a different account
            </button>
        </AuthPanel>
    );
}
