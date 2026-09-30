import Link from 'next/link';
import { AuthPanel } from '@/components/AuthPanel';

export default function VerifyEmailPage() {
    return (
        <AuthPanel quote="The secret of getting ahead is getting started." author="Mark Twain">
            <div
                style={{
                    width: 48,
                    height: 48,
                    borderRadius: 12,
                    background: '#eef6f1',
                    border: '1px solid #b6d9c2',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 20,
                }}
            >
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

            <div className="hint-box" style={{ marginBottom: 28 }}>
                <strong style={{ color: 'var(--td)' }}>Didn&apos;t receive the email?</strong>
                <br />
                Check your spam folder, or make sure you used your institutional address
                (e.g. <span style={{ fontFamily: 'monospace' }}>you@umass.edu</span>).
            </div>

            <Link href="/auth" className="btn btn-secondary" style={{ alignSelf: 'flex-start', height: 38, padding: '0 20px' }}>
                Back to sign in
            </Link>
        </AuthPanel>
    );
}
