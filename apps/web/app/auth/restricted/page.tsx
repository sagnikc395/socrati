'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function RestrictedPage() {
    const router = useRouter();

    const handleSignOut = async () => {
        const supabase = createClient();
        await supabase.auth.signOut();
        router.push('/auth');
    };

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
                            &ldquo;The roots of education are bitter, but the fruit is sweet.&rdquo;
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 9 }}>— Aristotle</div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--t3)' }}>UMass · Five College Community</div>
                </div>

                <div style={{
                    flex: 1,
                    background: 'var(--main)',
                    padding: '40px 36px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                }}>
                    <div style={{
                        width: 48, height: 48, borderRadius: 12,
                        background: '#fef0ee', border: '1px solid #f5c6c0',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginBottom: 20,
                    }}>
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

                    <div style={{
                        background: 'var(--hint)', border: '1px solid var(--hintb)',
                        borderRadius: 10, padding: '13px 16px', marginBottom: 28,
                    }}>
                        <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--t2)', marginBottom: 8, letterSpacing: '.04em', textTransform: 'uppercase' }}>
                            Accepted domains
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {['@umass.edu', '@smith.edu', '@hampshire.edu', '@mtholyoke.edu', '@amherst.edu'].map(d => (
                                <span key={d} style={{
                                    fontSize: 11, fontWeight: 500,
                                    background: 'var(--acl)', color: '#2a5c38',
                                    borderRadius: 6, padding: '3px 9px',
                                }}>
                                    {d}
                                </span>
                            ))}
                        </div>
                    </div>

                    <button
                        onClick={handleSignOut}
                        style={{
                            alignSelf: 'flex-start', height: 38, padding: '0 20px',
                            background: 'var(--acc)', color: '#eef8f2',
                            border: 'none', borderRadius: 9,
                            fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        }}
                    >
                        Sign in with a different account
                    </button>
                </div>
            </div>
        </div>
    );
}
