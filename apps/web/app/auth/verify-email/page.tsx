import Link from 'next/link';

export default function VerifyEmailPage() {
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
                            &ldquo;The secret of getting ahead is getting started.&rdquo;
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 9 }}>— Mark Twain</div>
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
                        background: '#eef6f1', border: '1px solid #b6d9c2',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        marginBottom: 20,
                    }}>
                        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                            <path d="M3 6l8 5 8-5" stroke="#2a7a4a" strokeWidth="1.5" strokeLinecap="round" />
                            <rect x="2" y="4" width="18" height="14" rx="3" stroke="#2a7a4a" strokeWidth="1.5" />
                        </svg>
                    </div>

                    <div style={{ fontSize: 20, fontWeight: 600, color: 'var(--td)', letterSpacing: '-0.2px', marginBottom: 8 }}>
                        Check your email
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--t2)', lineHeight: 1.7, marginBottom: 28, maxWidth: 340 }}>
                        We sent a confirmation link to your institutional email address.
                        Click the link to activate your account and get started.
                    </div>

                    <div style={{
                        background: 'var(--hint)', border: '1px solid var(--hintb)',
                        borderRadius: 10, padding: '13px 16px', marginBottom: 28,
                        fontSize: 12, color: 'var(--t2)', lineHeight: 1.6,
                    }}>
                        <strong style={{ color: 'var(--td)' }}>Didn&apos;t receive the email?</strong>
                        <br />
                        Check your spam folder, or make sure you used your institutional address
                        (e.g. <span style={{ fontFamily: 'monospace' }}>you@umass.edu</span>).
                    </div>

                    <Link
                        href="/auth"
                        style={{
                            alignSelf: 'flex-start', height: 38, padding: '0 20px',
                            background: 'var(--card)', color: 'var(--t1)',
                            border: '1px solid var(--b1)', borderRadius: 9,
                            fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                            cursor: 'pointer', display: 'flex', alignItems: 'center',
                            textDecoration: 'none',
                        }}
                    >
                        Back to sign in
                    </Link>
                </div>
            </div>
        </div>
    );
}
