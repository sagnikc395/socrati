import type { ReactNode } from 'react';

/**
 * Shared shell for the three auth pages (sign-in/up, verify-email, restricted):
 * centered card with the branded left panel. Quote and main content vary per page.
 */
export function AuthPanel({ quote, author, children }: { quote: string; author: string; children: ReactNode }) {
    return (
        <div
            style={{
                minHeight: '100vh',
                background: 'var(--main)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2rem',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    borderRadius: 16,
                    overflow: 'hidden',
                    border: '1px solid var(--b1)',
                    boxShadow: '0 1px 8px rgba(30,40,32,.06)',
                    width: '100%',
                    maxWidth: 780,
                }}
            >
                <div
                    style={{
                        width: 230,
                        background: 'var(--sb)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        padding: '28px 24px',
                        borderRight: '1px solid var(--sb1)',
                        flexShrink: 0,
                    }}
                >
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
                            &ldquo;{quote}&rdquo;
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 9 }}>— {author}</div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--t3)' }}>UMass · Five College Community</div>
                </div>

                <div
                    style={{
                        flex: 1,
                        background: 'var(--main)',
                        padding: '40px 36px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                    }}
                >
                    {children}
                </div>
            </div>
        </div>
    );
}
