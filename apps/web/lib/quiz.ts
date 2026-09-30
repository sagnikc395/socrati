import { getAnonSupabaseClient } from './supabase/api';
import { callGroqJson } from './groq';
import { z } from 'zod';

// ── Zod schemas ────────────────────────────────────────────────────────────────

const QuizQuestionSchema = z.object({
    type: z.enum(['multiple_choice', 'short_answer', 'true_false']),
    question: z.string().min(1),
    options: z.array(z.string()).optional(),
    correct_answer: z.string().min(1),
    explanation: z.string().min(1),
});

const QuizResponseSchema = z.object({
    questions: z.array(QuizQuestionSchema),
});

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export type QuizQuestionRow = QuizQuestion & {
    question_id: string;
    quiz_id: string;
    user_answer: string | null;
    is_correct: boolean | null;
};

export type QuizRow = {
    quiz_id: string;
    user_id: string;
    document_id: string;
    question_count: number;
    score: number | null;
    created_at: string;
};

// ── Quiz generation ────────────────────────────────────────────────────────────

export async function generateQuiz({
    documentId,
    userId,
    questionCount,
    accessToken,
}: {
    documentId: string;
    userId: string;
    questionCount: 5 | 10 | 20;
    accessToken: string;
}): Promise<{ quizId: string; questions: QuizQuestionRow[] }> {
    const supabase = getAnonSupabaseClient(accessToken);

    // 1. Fetch diverse chunks from the document
    const { data: chunks, error: chunkError } = await supabase
        .from('document_chunks')
        .select('content, chunk_index')
        .eq('document_id', documentId)
        .order('chunk_index', { ascending: true })
        .limit(5);

    if (chunkError) throw new Error(`Failed to fetch chunks: ${chunkError.message}`);
    if (!chunks || chunks.length === 0) throw new Error('No content found for this document.');

    // Sample evenly across the document for diversity
    const step = Math.max(1, Math.floor(chunks.length / questionCount));
    const sampledChunks = chunks.filter((_, i) => i % step === 0).slice(0, questionCount * 2);
    const contextText = sampledChunks.map((c) => c.content).join('\n\n---\n\n');

    // 2. Call Groq Llama 3 8B
    const prompt = `You are a quiz generator. Based on the following study material, generate exactly ${questionCount} quiz questions.

Use a mix of question types:
- multiple_choice: provide exactly 4 options as an array with full text (not letters), correct_answer must be the FULL TEXT of the correct option, not a letter like "A" or "B"
- true_false: options should be ["True", "False"], correct_answer is "True" or "False"
- short_answer: no options field, correct_answer is a brief phrase

For each question, include a brief explanation citing the source material.

Respond ONLY with a JSON object in this exact format, no markdown, no extra text:
{
  "questions": [
    {
      "type": "multiple_choice",
      "question": "What is the capital of France?",
      "options": ["London", "Paris", "Berlin", "Madrid"],
      "correct_answer": "Paris",
      "explanation": "Paris is the capital city of France."
    },
    {
      "type": "true_false",
      "question": "The sky is green.",
      "options": ["True", "False"],
      "correct_answer": "False",
      "explanation": "The sky appears blue due to Rayleigh scattering."
    },
    {
      "type": "short_answer",
      "question": "What is the powerhouse of the cell?",
      "correct_answer": "mitochondria",
      "explanation": "The mitochondria produces energy for the cell."
    }
  ]
}

STUDY MATERIAL:
${contextText}`;

    // 2. Call Groq Llama 3 8B and validate with Zod
    const parsed = QuizResponseSchema.parse(
        await callGroqJson({ prompt, temperature: 0.4, maxTokens: 5000 }),
    );

    const questions = parsed.questions.slice(0, questionCount);

    // 4. Save quiz row
    const { data: quizRow, error: quizError } = await supabase
        .from('quizzes')
        .insert({
            user_id: userId,
            document_id: documentId,
            question_count: questions.length,
        })
        .select('quiz_id')
        .single();

    if (quizError || !quizRow) throw new Error(`Failed to save quiz: ${quizError?.message}`);

    // 5. Save questions
    const questionRows = questions.map((q) => ({
        quiz_id: quizRow.quiz_id,
        type: q.type,
        question: q.question,
        options: q.options ?? null,
        correct_answer: q.correct_answer,
        explanation: q.explanation,
    }));

    const { data: savedQuestions, error: qError } = await supabase
        .from('quiz_questions')
        .insert(questionRows)
        .select('*');

    if (qError || !savedQuestions) throw new Error(`Failed to save questions: ${qError?.message}`);

    return {
        quizId: quizRow.quiz_id,
        questions: savedQuestions as QuizQuestionRow[],
    };
}

// ── Quiz submission & grading ──────────────────────────────────────────────────

export type AnswerSubmission = { questionId: string; userAnswer: string };

export async function submitQuiz({
    quizId,
    answers,
    accessToken,
}: {
    quizId: string;
    answers: AnswerSubmission[];
    accessToken: string;
}): Promise<{
    score: number;
    total: number;
    percentage: number;
    results: {
        question_id: string;
        is_correct: boolean;
        correct_answer: string;
        explanation: string;
        user_answer: string;
    }[];
}> {
    const supabase = getAnonSupabaseClient(accessToken);

    const { data: questions, error: fetchErr } = await supabase
        .from('quiz_questions')
        .select('*')
        .eq('quiz_id', quizId);

    if (fetchErr || !questions) throw new Error(`Failed to fetch quiz: ${fetchErr?.message}`);

    let score = 0;
    const results = questions.map((q: QuizQuestionRow) => {
        const submission = answers.find((a) => a.questionId === q.question_id);
        const userAnswer = submission?.userAnswer ?? '';
        const normalize = (s: string) =>
            s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 ]/g, '');
        const isCorrect = normalize(userAnswer) === normalize(q.correct_answer);
        if (isCorrect) score++;
        return {
            question_id: q.question_id,
            is_correct: isCorrect,
            correct_answer: q.correct_answer,
            explanation: q.explanation,
            user_answer: userAnswer,
        };
    });

    await Promise.all(
        results.map((r) =>
            supabase
                .from('quiz_questions')
                .update({ user_answer: r.user_answer, is_correct: r.is_correct })
                .eq('question_id', r.question_id),
        ),
    );

    await supabase.from('quizzes').update({ score }).eq('quiz_id', quizId);

    return {
        score,
        total: questions.length,
        percentage: Math.round((score / questions.length) * 100),
        results,
    };
}