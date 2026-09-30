'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

// ── Types ──────────────────────────────────────────────────────────────────────

type QuizAttempt = {
    quiz_id: string;
    score: number;
    question_count: number;
    created_at: string;
    document_id: string;
    document_title: string;
};

type TopicStat = {
    title: string;
    attempts: number;
    bestScore: number;
    status: 'Mastered' | 'In Progress' | 'Needs Review';
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function getStatus(pct: number): TopicStat['status'] {
    if (pct >= 80) return 'Mastered';
    if (pct >= 50) return 'In Progress';
    return 'Needs Review';
}

function statusColor(status: TopicStat['status']) {
    if (status === 'Mastered') return { bg: 'var(--acl)', text: 'var(--acc1)' };
    if (status === 'In Progress') return { bg: '#fef9c3', text: '#854d0e' };
    return { bg: '#fef2f2', text: '#b91c1c' };
}

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ onStart }: { onStart: () => void }) {
    return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ textAlign: 'center', maxWidth: 400 }}>
                <div style={{ fontSize: 40, marginBottom: 16 }}>📊</div>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: 'var(--td)', marginBottom: 8 }}>
                    No quiz data yet
                </h2>
                <p style={{ fontSize: 14, color: 'var(--t2)', lineHeight: 1.6, marginBottom: 24 }}>
                    Complete at least one quiz to start tracking your progress. Your scores, topics, and improvement trends will appear here.
                </p>
                <button onClick={onStart} className="btn btn-primary" style={{ padding: '10px 20px', fontSize: 14 }}>
                    Go to Sessions
                </button>
            </div>
        </div>
    );
}

// ── Score bar ──────────────────────────────────────────────────────────────────

function ScoreBar({ pct, color = 'var(--acc)' }: { pct: number; color?: string }) {
    return (
        <div className="meter">
            <div style={{ width: `${pct}%`, background: color }} />
        </div>
    );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function ProgressPage() {
    const router = useRouter();
    const [attempts, setAttempts] = useState<QuizAttempt[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/progress')
            .then((r) => {
                if (!r.ok) throw new Error('Failed to load progress data.');
                return r.json();
            })
            .then((data) => setAttempts(data.attempts ?? []))
            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Unknown error'))
            .finally(() => setLoading(false));
    }, []);

    // ── Derived stats ────────────────────────────────────────────────────────

    const completedAttempts = attempts.filter((a) => a.score !== null);
    const totalQuizzes = completedAttempts.length;
    const overallPct = totalQuizzes === 0
        ? 0
        : Math.round(
            completedAttempts.reduce((sum, a) => sum + (a.score / a.question_count) * 100, 0) /
            totalQuizzes,
        );

    // Group by document title for per-topic stats
    const topicMap = new Map<string, QuizAttempt[]>();
    for (const a of completedAttempts) {
        const key = a.document_title ?? 'Unknown document';
        topicMap.set(key, [...(topicMap.get(key) ?? []), a]);
    }

    const topics: TopicStat[] = Array.from(topicMap.entries()).map(([title, atts]) => {
        const best = Math.max(...atts.map((a) => Math.round((a.score / a.question_count) * 100)));
        return { title, attempts: atts.length, bestScore: best, status: getStatus(best) };
    });

    // Chart data: last 10 attempts sorted by date
    const chartData = [...completedAttempts]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .slice(-10)
        .map((a) => ({
            label: formatDate(a.created_at),
            pct: Math.round((a.score / a.question_count) * 100),
            title: a.document_title,
        }));

    const masteredCount = topics.filter((t) => t.status === 'Mastered').length;
    const needsReviewCount = topics.filter((t) => t.status === 'Needs Review').length;

    return (
        <div className="shell">
            <Sidebar />
            <main>
                {/* Header */}
                <div className="page-head" style={{ padding: '20px 32px 15px' }}>
                    <h1>My Progress</h1>
                    <p>Track your quiz scores and learning trends</p>
                </div>

                {loading && (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--t3)', fontSize: 14 }}>
                        Loading...
                    </div>
                )}

                {error && (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#b91c1c', fontSize: 14 }}>
                        {error}
                    </div>
                )}

                {!loading && !error && totalQuizzes === 0 && (
                    <EmptyState onStart={() => router.push('/sessions')} />
                )}

                {!loading && !error && totalQuizzes > 0 && (
                    <div style={{ flex: 1, overflowY: 'auto', padding: '28px 32px' }}>
                        <div style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

                            {/* ── Summary cards ── */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                                {[
                                    { label: 'Overall Score', value: `${overallPct}%`, sub: `across ${totalQuizzes} quiz${totalQuizzes !== 1 ? 'zes' : ''}` },
                                    { label: 'Topics Mastered', value: masteredCount, sub: `of ${topics.length} topic${topics.length !== 1 ? 's' : ''}` },
                                    { label: 'Needs Review', value: needsReviewCount, sub: 'topics below 50%' },
                                ].map((card) => (
                                    <div key={card.label} className="card" style={{ padding: '20px 24px' }}>
                                        <div className="overline" style={{ fontSize: 11, letterSpacing: '.06em', marginBottom: 8 }}>
                                            {card.label}
                                        </div>
                                        <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--td)', marginBottom: 4 }}>
                                            {card.value}
                                        </div>
                                        <div style={{ fontSize: 12, color: 'var(--t2)' }}>{card.sub}</div>
                                    </div>
                                ))}
                            </div>

                            {/* ── Score trend chart ── */}
                            <div className="card" style={{ padding: '20px 24px' }}>
                                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--td)', marginBottom: 20 }}>
                                    Score Trend (last {chartData.length} quizzes)
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 120 }}>
                                    {chartData.map((d, i) => (
                                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                                            <div style={{ fontSize: 10, color: 'var(--t3)', fontWeight: 500 }}>{d.pct}%</div>
                                            <div
                                                title={`${d.title} — ${d.pct}% on ${d.label}`}
                                                style={{
                                                    width: '100%',
                                                    height: `${Math.max(d.pct, 4)}%`,
                                                    background: d.pct >= 80 ? 'var(--acc)' : d.pct >= 50 ? '#fbbf24' : '#f87171',
                                                    borderRadius: '4px 4px 0 0',
                                                    transition: 'height 0.4s ease',
                                                    minHeight: 4,
                                                }}
                                            />
                                            <div style={{ fontSize: 9, color: 'var(--t3)', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '100%', textOverflow: 'ellipsis' }}>
                                                {d.label}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {/* Legend */}
                                <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
                                    {[
                                        { color: 'var(--acc)', label: 'Mastered (≥80%)' },
                                        { color: '#fbbf24', label: 'In Progress (50–79%)' },
                                        { color: '#f87171', label: 'Needs Review (<50%)' },
                                    ].map((l) => (
                                        <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                            <div style={{ width: 10, height: 10, borderRadius: 2, background: l.color, flexShrink: 0 }} />
                                            <span style={{ fontSize: 10, color: 'var(--t3)' }}>{l.label}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* ── Per-topic breakdown ── */}
                            <div className="card" style={{ padding: '20px 24px' }}>
                                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--td)', marginBottom: 16 }}>
                                    Topics
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                                    {topics.map((t) => {
                                        const colors = statusColor(t.status);
                                        return (
                                            <div key={t.title}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                                        <span className="ellipsis" style={{ fontSize: 13, color: 'var(--td)', fontWeight: 500 }}>
                                                            {t.title}
                                                        </span>
                                                        <span style={{
                                                            fontSize: 10,
                                                            fontWeight: 500,
                                                            padding: '2px 8px',
                                                            borderRadius: 99,
                                                            background: colors.bg,
                                                            color: colors.text,
                                                            flexShrink: 0,
                                                        }}>
                                                            {t.status}
                                                        </span>
                                                    </div>
                                                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--td)', flexShrink: 0, marginLeft: 12 }}>
                                                        {t.bestScore}%
                                                    </span>
                                                </div>
                                                <ScoreBar pct={t.bestScore} color={
                                                    t.status === 'Mastered' ? 'var(--acc)' :
                                                    t.status === 'In Progress' ? '#fbbf24' : '#f87171'
                                                } />
                                                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 4 }}>
                                                    {t.attempts} quiz attempt{t.attempts !== 1 ? 's' : ''}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* ── Recommendations ── */}
                            {needsReviewCount > 0 && (
                                <div className="error-box" style={{ borderRadius: 12, padding: '16px 20px' }}>
                                    <div style={{ fontSize: 13, fontWeight: 500, color: '#b91c1c', marginBottom: 8 }}>
                                        📚 Recommended: Review these topics
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        {topics
                                            .filter((t) => t.status === 'Needs Review')
                                            .map((t) => (
                                                <div key={t.title} style={{ fontSize: 13, color: '#7f1d1d' }}>
                                                    • {t.title} — best score {t.bestScore}%, try another quiz to improve
                                                </div>
                                            ))}
                                    </div>
                                </div>
                            )}

                            {/* ── Recent quiz history ── */}
                            <div className="card" style={{ padding: '20px 24px' }}>
                                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--td)', marginBottom: 16 }}>
                                    Recent Quizzes
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {[...completedAttempts]
                                        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                                        .slice(0, 8)
                                        .map((a) => {
                                            const pct = Math.round((a.score / a.question_count) * 100);
                                            const status = getStatus(pct);
                                            const colors = statusColor(status);
                                            return (
                                                <div key={a.quiz_id} style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    padding: '10px 14px',
                                                    background: 'var(--main)',
                                                    borderRadius: 8,
                                                    border: '1px solid var(--b1)',
                                                }}>
                                                    <div style={{ minWidth: 0 }}>
                                                        <div className="ellipsis" style={{ fontSize: 13, color: 'var(--td)', fontWeight: 500 }}>
                                                            {a.document_title}
                                                        </div>
                                                        <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2 }}>
                                                            {formatDate(a.created_at)} · {a.question_count} questions
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 12 }}>
                                                        <span className="badge" style={{ background: colors.bg, color: colors.text }}>
                                                            {status}
                                                        </span>
                                                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--td)' }}>
                                                            {a.score}/{a.question_count}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                </div>
                            </div>

                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
