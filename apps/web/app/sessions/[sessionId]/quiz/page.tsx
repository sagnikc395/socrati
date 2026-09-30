'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

// ── Types ──────────────────────────────────────────────────────────────────────

type QuizQuestion = {
    question_id: string;
    type: 'multiple_choice' | 'short_answer' | 'true_false';
    question: string;
    options?: string[];
    correct_answer: string;
    explanation: string;
};

type QuizResult = {
    question_id: string;
    is_correct: boolean;
    correct_answer: string;
    explanation: string;
    user_answer: string;
};

type Phase = 'setup' | 'generating' | 'taking' | 'submitting' | 'results';

// ── Setup Screen ───────────────────────────────────────────────────────────────

function SetupScreen({
    documentId,
    onStart,
    error,
}: {
    documentId: string | null;
    onStart: (count: 5 | 10 | 20) => void;
    error: string | null;
}) {
    const [selected, setSelected] = useState<5 | 10 | 20>(10);

    return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{
                background: 'var(--card)',
                border: '1px solid var(--b1)',
                borderRadius: 16,
                padding: '40px 48px',
                maxWidth: 440,
                width: '100%',
                textAlign: 'center',
            }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>📝</div>
                <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--td)', marginBottom: 8 }}>
                    Generate a Practice Quiz
                </h2>
                <p style={{ fontSize: 13, color: 'var(--t2)', marginBottom: 32, lineHeight: 1.6 }}>
                    Questions will be drawn from your uploaded study material.
                </p>

                <div style={{ marginBottom: 28 }}>
                    <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--t3)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                        Number of questions
                    </p>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                        {([5, 10, 20] as const).map((n) => (
                            <button
                                key={n}
                                onClick={() => setSelected(n)}
                                style={{
                                    width: 72,
                                    height: 44,
                                    borderRadius: 10,
                                    border: `2px solid ${selected === n ? 'var(--acc)' : 'var(--b1)'}`,
                                    background: selected === n ? 'var(--acl)' : 'var(--main)',
                                    color: selected === n ? 'var(--acc1)' : 'var(--t2)',
                                    fontWeight: selected === n ? 600 : 400,
                                    fontSize: 16,
                                    cursor: 'pointer',
                                    fontFamily: 'inherit',
                                    transition: 'all 0.15s',
                                }}
                            >
                                {n}
                            </button>
                        ))}
                    </div>
                </div>

                {error && (
                    <div style={{
                        background: '#fef2f2',
                        border: '1px solid #fca5a5',
                        borderRadius: 8,
                        padding: '10px 14px',
                        fontSize: 13,
                        color: '#b91c1c',
                        marginBottom: 20,
                    }}>
                        {error}
                    </div>
                )}

                {!documentId && (
                    <div style={{
                        background: '#fffbeb',
                        border: '1px solid #fcd34d',
                        borderRadius: 8,
                        padding: '10px 14px',
                        fontSize: 13,
                        color: '#92400e',
                        marginBottom: 20,
                    }}>
                        No document found for this session. Go back and make sure a document is attached.
                    </div>
                )}

                <button
                    onClick={() => onStart(selected)}
                    disabled={!documentId}
                    style={{
                        width: '100%',
                        padding: '13px 0',
                        borderRadius: 10,
                        border: 'none',
                        background: documentId ? 'var(--acc)' : 'var(--b1)',
                        color: 'white',
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: documentId ? 'pointer' : 'default',
                        fontFamily: 'inherit',
                    }}
                >
                    Generate Quiz
                </button>
            </div>
        </div>
    );
}

// ── Question Card ──────────────────────────────────────────────────────────────

function QuestionCard({
    question,
    index,
    total,
    answer,
    onAnswer,
}: {
    question: QuizQuestion;
    index: number;
    total: number;
    answer: string;
    onAnswer: (val: string) => void;
}) {
    const choices =
        question.type === 'true_false'
            ? ['True', 'False']
            : question.options ?? [];

    return (
        <div style={{
            background: 'var(--card)',
            border: '1px solid var(--b1)',
            borderRadius: 14,
            padding: '28px 32px',
            maxWidth: 680,
            width: '100%',
        }}>
            <div style={{ fontSize: 11, color: 'var(--t3)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Question {index + 1} of {total}
            </div>

            <p style={{ fontSize: 16, fontWeight: 500, color: 'var(--td)', lineHeight: 1.6, marginBottom: 24 }}>
                {question.question}
            </p>

            {(question.type === 'multiple_choice' || question.type === 'true_false') && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {choices.map((opt) => (
                        <button
                            key={opt}
                            onClick={() => onAnswer(opt)}
                            style={{
                                textAlign: 'left',
                                padding: '12px 16px',
                                borderRadius: 10,
                                border: `2px solid ${answer === opt ? 'var(--acc)' : 'var(--b1)'}`,
                                background: answer === opt ? 'var(--acl)' : 'var(--main)',
                                color: answer === opt ? 'var(--acc1)' : 'var(--td)',
                                fontSize: 14,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                fontWeight: answer === opt ? 500 : 400,
                                transition: 'all 0.12s',
                            }}
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            )}

            {question.type === 'short_answer' && (
                <textarea
                    value={answer}
                    onChange={(e) => onAnswer(e.target.value)}
                    placeholder="Type your answer..."
                    rows={3}
                    style={{
                        width: '100%',
                        padding: '12px 14px',
                        borderRadius: 10,
                        border: '1.5px solid var(--b1)',
                        background: 'var(--main)',
                        fontSize: 14,
                        color: 'var(--td)',
                        fontFamily: 'inherit',
                        resize: 'vertical',
                        outline: 'none',
                    }}
                    onFocus={(e) => { e.target.style.borderColor = 'var(--acc)'; }}
                    onBlur={(e) => { e.target.style.borderColor = 'var(--b1)'; }}
                />
            )}
        </div>
    );
}

// ── Results Screen ─────────────────────────────────────────────────────────────

function ResultsScreen({
    score,
    total,
    percentage,
    results,
    questions,
    onReturnToSession,
}: {
    score: number;
    total: number;
    percentage: number;
    results: QuizResult[];
    questions: QuizQuestion[];
    onReturnToSession: () => void;
}) {
    const emoji = percentage >= 80 ? '🎉' : percentage >= 60 ? '👍' : '📚';

    return (
        <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px' }}>
            <div style={{ maxWidth: 680, margin: '0 auto' }}>
                <div style={{
                    background: 'var(--card)',
                    border: '1px solid var(--b1)',
                    borderRadius: 14,
                    padding: '32px',
                    textAlign: 'center',
                    marginBottom: 24,
                }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>{emoji}</div>
                    <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--td)', marginBottom: 6 }}>
                        {score}/{total} — {percentage}%
                    </h2>
                    <p style={{ fontSize: 14, color: 'var(--t2)' }}>
                        {percentage >= 80
                            ? 'Excellent work! You have a strong grasp of this material.'
                            : percentage >= 60
                              ? 'Good effort. Review the questions you missed below.'
                              : 'Keep studying! The explanations below will help.'}
                    </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 28 }}>
                    {results.map((r, i) => {
                        const q = questions.find((q) => q.question_id === r.question_id);
                        return (
                            <div key={r.question_id} style={{
                                background: 'var(--card)',
                                border: `1.5px solid ${r.is_correct ? 'var(--acl2)' : '#fca5a5'}`,
                                borderRadius: 12,
                                padding: '18px 20px',
                            }}>
                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                    <span style={{ fontSize: 16, marginTop: 1 }}>{r.is_correct ? '✅' : '❌'}</span>
                                    <div style={{ flex: 1 }}>
                                        <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--td)', marginBottom: 8 }}>
                                            {i + 1}. {q?.question}
                                        </p>
                                        {!r.is_correct && r.user_answer && (
                                            <p style={{ fontSize: 12, color: '#b91c1c', marginBottom: 4 }}>
                                                Your answer: {r.user_answer}
                                            </p>
                                        )}
                                        {!r.is_correct && (
                                            <p style={{ fontSize: 12, color: 'var(--acc1)', marginBottom: 6 }}>
                                                Correct answer: {r.correct_answer}
                                            </p>
                                        )}
                                        <p style={{ fontSize: 12, color: 'var(--t2)', lineHeight: 1.6 }}>
                                            {r.explanation}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <button
                    onClick={onReturnToSession}
                    style={{
                        width: '100%',
                        padding: '13px 0',
                        borderRadius: 10,
                        border: 'none',
                        background: 'var(--acc)',
                        color: 'white',
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: 'pointer',
                        fontFamily: 'inherit',
                    }}
                >
                    Return to Session
                </button>
            </div>
        </div>
    );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function QuizPage() {
    const { sessionId } = useParams<{ sessionId: string }>();
    const router = useRouter();

    const [phase, setPhase] = useState<Phase>('setup');
    const [documentId, setDocumentId] = useState<string | null>(null);
    const [quizId, setQuizId] = useState<string | null>(null);
    const [questions, setQuestions] = useState<QuizQuestion[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [results, setResults] = useState<QuizResult[]>([]);
    const [score, setScore] = useState(0);
    const [percentage, setPercentage] = useState(0);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetch(`/api/sessions/${sessionId}`)
            .then((r) => r.json())
            .then((data) => {
                if (cancelled) return;
                const docs = data.documents ?? [];
                if (docs.length > 0) setDocumentId(docs[0].document_id);
            })
            .catch(() => {
                if (!cancelled) setError('Could not load session documents.');
            });
        return () => {
            cancelled = true;
        };
    }, [sessionId]);

    const handleStart = async (questionCount: 5 | 10 | 20) => {
        if (!documentId) return;
        setError(null);
        setPhase('generating');

        const res = await fetch('/api/quiz/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documentId, questionCount }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Unknown error' }));
            setError(err.error ?? 'Failed to generate quiz.');
            setPhase('setup');
            return;
        }

        const data = await res.json();
        setQuizId(data.quizId);
        setQuestions(data.questions);
        setCurrentIndex(0);
        setAnswers({});
        setPhase('taking');
    };

    const handleAnswer = (val: string) => {
        const q = questions[currentIndex];
        if (!q) return;
        setAnswers((prev) => ({ ...prev, [q.question_id]: val }));
    };

    const handleNext = () => {
        if (currentIndex < questions.length - 1) setCurrentIndex((i) => i + 1);
    };

    const handlePrev = () => {
        if (currentIndex > 0) setCurrentIndex((i) => i - 1);
    };

    const handleSubmit = async () => {
        if (!quizId) return;
        setPhase('submitting');

        const answerPayload = questions.map((q) => ({
            questionId: q.question_id,
            userAnswer: answers[q.question_id] ?? '',
        }));

        const res = await fetch(`/api/quiz/${quizId}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers: answerPayload }),
        });

        if (!res.ok) {
            setError('Failed to submit quiz. Please try again.');
            setPhase('taking');
            return;
        }

        const data = await res.json();
        setScore(data.score);
        setPercentage(data.percentage);
        setResults(data.results);
        setPhase('results');
    };

    const currentQuestion = questions[currentIndex];
    const currentAnswer = currentQuestion ? (answers[currentQuestion.question_id] ?? '') : '';
    const answeredCount = Object.keys(answers).length;
    const allAnswered = answeredCount === questions.length;

    return (
        <div style={{ display: 'flex', minHeight: '100vh' }}>
            <Sidebar />
            <main style={{ flex: 1, background: 'var(--main)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '20px 24px 15px', borderBottom: '1px solid var(--b1)', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                        onClick={() => router.push(`/sessions/${sessionId}`)}
                        style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            color: 'var(--t2)',
                            fontSize: 13,
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            fontFamily: 'inherit',
                            padding: 0,
                        }}
                    >
                        ← Back to session
                    </button>
                    <span style={{ color: 'var(--b2)' }}>|</span>
                    <h1 style={{ fontSize: 16, fontWeight: 600, color: 'var(--td)' }}>Practice Quiz</h1>
                </div>

                {phase === 'setup' && (
                    <SetupScreen documentId={documentId} onStart={handleStart} error={error} />
                )}

                {phase === 'generating' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                        <div style={{ fontSize: 28 }}>⏳</div>
                        <p style={{ fontSize: 14, color: 'var(--t2)' }}>Generating your quiz from the document...</p>
                    </div>
                )}

                {phase === 'taking' && currentQuestion && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 24px', gap: 20, overflowY: 'auto' }}>
                        <div style={{ width: '100%', maxWidth: 680 }}>
                            <div style={{ height: 4, background: 'var(--b1)', borderRadius: 99, overflow: 'hidden' }}>
                                <div style={{
                                    height: '100%',
                                    width: `${((currentIndex + 1) / questions.length) * 100}%`,
                                    background: 'var(--acc)',
                                    borderRadius: 99,
                                    transition: 'width 0.3s',
                                }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                                <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                                    {answeredCount}/{questions.length} answered
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--t3)' }}>
                                    {currentIndex + 1} / {questions.length}
                                </span>
                            </div>
                        </div>

                        <QuestionCard
                            question={currentQuestion}
                            index={currentIndex}
                            total={questions.length}
                            answer={currentAnswer}
                            onAnswer={handleAnswer}
                        />

                        <div style={{ display: 'flex', gap: 10, maxWidth: 680, width: '100%' }}>
                            <button
                                onClick={handlePrev}
                                disabled={currentIndex === 0}
                                style={{
                                    flex: 1,
                                    padding: '12px 0',
                                    borderRadius: 10,
                                    border: '1.5px solid var(--b1)',
                                    background: 'var(--card)',
                                    color: 'var(--t2)',
                                    fontSize: 14,
                                    cursor: currentIndex === 0 ? 'default' : 'pointer',
                                    opacity: currentIndex === 0 ? 0.4 : 1,
                                    fontFamily: 'inherit',
                                }}
                            >
                                ← Previous
                            </button>

                            {currentIndex < questions.length - 1 ? (
                                <button
                                    onClick={handleNext}
                                    style={{
                                        flex: 1,
                                        padding: '12px 0',
                                        borderRadius: 10,
                                        border: 'none',
                                        background: 'var(--acc)',
                                        color: 'white',
                                        fontSize: 14,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        fontFamily: 'inherit',
                                    }}
                                >
                                    Next →
                                </button>
                            ) : (
                                <button
                                    onClick={handleSubmit}
                                    disabled={!allAnswered}
                                    style={{
                                        flex: 1,
                                        padding: '12px 0',
                                        borderRadius: 10,
                                        border: 'none',
                                        background: allAnswered ? 'var(--acc)' : 'var(--b1)',
                                        color: 'white',
                                        fontSize: 14,
                                        fontWeight: 600,
                                        cursor: allAnswered ? 'pointer' : 'default',
                                        fontFamily: 'inherit',
                                    }}
                                >
                                    {allAnswered ? 'Submit Quiz' : `Answer all questions (${questions.length - answeredCount} left)`}
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {phase === 'submitting' && (
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
                        <div style={{ fontSize: 28 }}>⏳</div>
                        <p style={{ fontSize: 14, color: 'var(--t2)' }}>Grading your answers...</p>
                    </div>
                )}

                {phase === 'results' && (
                    <ResultsScreen
                        score={score}
                        total={questions.length}
                        percentage={percentage}
                        results={results}
                        questions={questions}
                        onReturnToSession={() => router.push(`/sessions/${sessionId}`)}
                    />
                )}
            </main>
        </div>
    );
}