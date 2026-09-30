import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import { fetchUserSessions } from '@/lib/sessions-list';

export const metadata = {
    title: 'Your Sessions | Socrati',
};

// Next.js Server Component
export default async function SessionsListPage() {
    const cookieStore = await cookies();

    // Initialize Supabase
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll: () => cookieStore.getAll() } }
    );

    // 1. Authenticate User
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        redirect('/auth');
    }

    // 2. Fetch Sessions and Documents using our lib
    const { sessions: sessionList, error } = await fetchUserSessions(supabase, user.id);

    if (error) {
        console.error("Failed to fetch sessions:", error);
    }

    return (
        <div className="shell" style={{ height: '100vh' }}>
            <Sidebar />

            <main style={{ overflowY: 'auto' }}>
                <div style={{ padding: '40px 60px', maxWidth: 1000, margin: '0 auto', width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
                        <div>
                            <h1 style={{ fontSize: 24, fontWeight: 600, color: 'var(--td)', margin: 0 }}>Study Sessions</h1>
                            <p style={{ fontSize: 14, color: 'var(--t2)', marginTop: 8 }}>Resume your past Socratic tutoring sessions.</p>
                        </div>
                        <Link
                            href="/session/new"
                            className="btn btn-primary"
                            style={{ padding: '10px 16px', fontSize: 14 }}
                        >
                            + New Session
                        </Link>
                    </div>

                    {sessionList.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'var(--card)', borderRadius: 12, border: '1px dashed var(--b1)' }}>
                            <div style={{ fontSize: 40, marginBottom: 16 }}>📚</div>
                            <h2 style={{ fontSize: 16, fontWeight: 500, color: 'var(--td)', margin: 0 }}>No sessions yet</h2>
                            <p style={{ fontSize: 14, color: 'var(--t2)', marginTop: 8, marginBottom: 24 }}>Upload some documents to start your first Socratic study session.</p>
                            <Link
                                href="/session/new"
                                className="btn btn-secondary"
                                style={{ fontSize: 13 }}
                            >
                                Start a Session
                            </Link>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20 }}>
                            {sessionList.map((session) => {
                                const date = new Date(session.created_at).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric'
                                });
                                
                                const titles = session.titles;

                                return (
                                    <Link 
                                        key={session.session_id} 
                                        href={`/sessions/${session.session_id}`}
                                        style={{ textDecoration: 'none' }}
                                    >
                                        <div className="session-card card" style={{
                                            padding: 20,
                                            height: '100%',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            cursor: 'pointer'
                                        }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                                <span style={{ fontSize: 12, color: 'var(--t3)', fontWeight: 500 }}>{date}</span>
                                                <svg viewBox="0 0 14 14" fill="none" width={14} height={14} style={{ color: 'var(--t3)' }}>
                                                    <path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                            </div>
                                            
                                            <h3 style={{ fontSize: 15, fontWeight: 500, color: 'var(--td)', margin: '0 0 12px 0', lineHeight: 1.4 }}>
                                                {titles.length > 0 ? titles[0] : 'Empty Session'}
                                                {titles.length > 1 && (
                                                    <span style={{ color: 'var(--t2)', fontSize: 13 }}> + {titles.length - 1} more</span>
                                                )}
                                            </h3>
                                            
                                            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--acc)' }} />
                                                <span style={{ fontSize: 12, color: 'var(--t2)' }}>{titles.length} Document{titles.length !== 1 && 's'}</span>
                                            </div>
                                        </div>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
}
