import {
    boolean,
    index,
    integer,
    jsonb,
    numeric,
    pgTable,
    text,
    timestamp,
    uuid,
    vector,
} from 'drizzle-orm/pg-core';

/**
 * Baseline schema mirroring supabase/migrations 0001–0011, plus the Phase-2
 * additions in 0012 (llm_usage table, document_chunks.content_hash).
 *
 * This file is now the source of truth: edit here, then `npm run db:generate`
 * to produce the next migration. Migrations 0001–0011 are history — do not edit.
 */

// ── 0001/0002/0004: users (profile rows mirrored from auth.users) ────────────

export const users = pgTable('users', {
    userId: uuid('user_id').primaryKey(),
    email: text('email').notNull(),
    name: text('name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── 0002 + 0003: documents ───────────────────────────────────────────────────

export const documents = pgTable('documents', {
    documentId: uuid('document_id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.userId, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    fileType: text('file_type').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    parseStatus: text('parse_status').notNull().default('pending'), // pending | processing | ready | failed
    errorMessage: text('error_message'),
});

// ── 0002 + 0003 + 0010: document_chunks ──────────────────────────────────────

export const documentChunks = pgTable(
    'document_chunks',
    {
        chunkId: uuid('chunk_id').primaryKey().defaultRandom(),
        documentId: uuid('document_id')
            .notNull()
            .references(() => documents.documentId, { onDelete: 'cascade' }),
        chunkIndex: integer('chunk_index').notNull(),
        content: text('content').notNull(),
        embedding: vector('embedding', { dimensions: 1536 }),
        heading: text('heading'),
        keyTerms: text('key_terms').array().notNull().default([]),
        // Phase 2: sha256 of content — re-uploads skip re-embedding (0012)
        contentHash: text('content_hash'),
        createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [index('document_chunks_embedding_idx').using('ivfflat', table.embedding.op('vector_cosine_ops'))],
);

// ── 0006: sessions ───────────────────────────────────────────────────────────

export const sessions = pgTable('sessions', {
    sessionId: uuid('session_id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.userId, { onDelete: 'cascade' }),
    documentIds: uuid('document_ids').array().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── 0008: messages ───────────────────────────────────────────────────────────

export const messages = pgTable('messages', {
    messageId: uuid('message_id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
        .notNull()
        .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.userId, { onDelete: 'cascade' }),
    role: text('role').notNull(), // user | assistant
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── 0009: quizzes + quiz_questions ───────────────────────────────────────────

export const quizzes = pgTable('quizzes', {
    quizId: uuid('quiz_id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.userId, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
        .notNull()
        .references(() => documents.documentId, { onDelete: 'cascade' }),
    questionCount: integer('question_count').notNull(),
    score: integer('score'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const quizQuestions = pgTable('quiz_questions', {
    questionId: uuid('question_id').primaryKey().defaultRandom(),
    quizId: uuid('quiz_id')
        .notNull()
        .references(() => quizzes.quizId, { onDelete: 'cascade' }),
    type: text('type').notNull(), // multiple_choice | short_answer | true_false
    question: text('question').notNull(),
    options: jsonb('options'),
    correctAnswer: text('correct_answer').notNull(),
    explanation: text('explanation').notNull(),
    userAnswer: text('user_answer'),
    isCorrect: boolean('is_correct'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── 0012: llm_usage (Phase 2 observability — one row per LLM call) ───────────

export const llmUsage = pgTable('llm_usage', {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.userId, { onDelete: 'set null' }),
    sessionId: uuid('session_id').references(() => sessions.sessionId, { onDelete: 'set null' }),
    feature: text('feature').notNull(), // chat | quiz | mindmap | voice | voice-stt
    provider: text('provider').notNull(), // groq | fallback
    model: text('model').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: numeric('cost_usd'),
    ttftMs: integer('ttft_ms'),
    totalMs: integer('total_ms'),
    cacheHit: boolean('cache_hit').default(false),
    fallbackUsed: boolean('fallback_used').default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── 0013: voice_turns (Phase 3 — one row per recorded voice turn) ────────────

export const voiceTurns = pgTable('voice_turns', {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
        .notNull()
        .references(() => sessions.sessionId, { onDelete: 'cascade' }),
    userId: uuid('user_id')
        .notNull()
        .references(() => users.userId, { onDelete: 'cascade' }),
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type').notNull().default('audio/webm'),
    durationMs: integer('duration_ms'),
    status: text('status').notNull().default('pending'), // pending | processing | ready | failed
    transcript: text('transcript'),
    reply: text('reply'),
    errorMessage: text('error_message'),
    audioHash: text('audio_hash'),
    sttMs: integer('stt_ms'),
    retrievalMs: integer('retrieval_ms'),
    llmMs: integer('llm_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
