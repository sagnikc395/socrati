import { and, eq, isNotNull } from 'drizzle-orm';
import { documentChunks, documents, llmUsage, messages, voiceTurns } from './db/schema';
import { getDb } from './db/client';
import { logDocument } from './logger';
import type { EmbeddedChunk } from './embedder';

// ── Public types ───────────────────────────────────────────────────────────

export type ParseStatus = 'pending' | 'processing' | 'ready' | 'failed';

/**
 * Data access for trusted server paths (the BullMQ worker). Writes go over a
 * direct Postgres connection (Drizzle) — RLS does not apply, which matches the
 * previous service-role behavior. Ownership is established upstream: jobs are
 * only enqueued by the authenticated upload route.
 *
 * User-facing reads (RLS-scoped) stay on Supabase clients with the caller's
 * JWT — see rag.ts and the route handlers.
 *
 * `db` is an explicit parameter (defaults to the pooled singleton) so tests
 * can stub it.
 */

export async function updateParseStatus(
    documentId: string,
    status: ParseStatus,
    errorMessage?: string,
    db: ReturnType<typeof getDb> = getDb(),
) {
    logDocument.event('repository', 'updating parse status', { documentId, status });

    try {
        await db
            .update(documents)
            .set({ parseStatus: status, errorMessage: errorMessage ?? null })
            .where(eq(documents.documentId, documentId));
    } catch (error) {
        logDocument.error('repository', 'update parse status failed', error, {
            documentId,
            status,
        });
        throw new Error(
            `updateParseStatus failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    logDocument.event('repository', 'parse status updated', { documentId, status });
}

export async function saveChunks(
    documentId: string,
    chunks: EmbeddedChunk[],
    db: ReturnType<typeof getDb> = getDb(),
) {
    if (chunks.length === 0) return;

    logDocument.event('repository', 'saving chunks', {
        documentId,
        chunkCount: chunks.length,
        embeddingDimensions: chunks[0]?.embedding.length ?? 0,
    });

    const rows = chunks.map((chunk) => ({
        documentId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
        heading: chunk.heading ?? null,
        keyTerms: chunk.keyTerms,
        // postgres-js serializes number[] into pgvector's text format natively
        embedding: chunk.embedding,
        contentHash: chunk.contentHash ?? null,
    }));

    try {
        // Retry-safe: a failed attempt may have partially saved rows; start clean.
        await db.delete(documentChunks).where(eq(documentChunks.documentId, documentId));
        await db.insert(documentChunks).values(rows);
    } catch (error) {
        logDocument.error('repository', 'save chunks failed', error, {
            documentId,
            chunkCount: chunks.length,
        });
        throw new Error(
            `saveChunks failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }

    logDocument.event('repository', 'chunks saved', { documentId, chunkCount: chunks.length });
}

/** Existing embeddings for a document, keyed by content hash (embedding reuse). */
export async function getEmbeddingsByHash(
    documentId: string,
    db: ReturnType<typeof getDb> = getDb(),
): Promise<Map<string, number[]>> {
    const rows = await db
        .select({ contentHash: documentChunks.contentHash, embedding: documentChunks.embedding })
        .from(documentChunks)
        .where(eq(documentChunks.documentId, documentId));

    const map = new Map<string, number[]>();
    for (const row of rows) {
        if (!row.contentHash || !row.embedding) continue;
        // pgvector returns "[1,2,3]" text through postgres-js
        const vector = String(row.embedding)
            .slice(1, -1)
            .split(',')
            .map(Number)
            .filter((n) => Number.isFinite(n));
        if (vector.length > 0) map.set(row.contentHash, vector);
    }
    return map;
}

// ── Phase 3: voice turns ─────────────────────────────────────────────────────

export type VoiceTurnPatch = {
    status?: string;
    transcript?: string | null;
    reply?: string | null;
    errorMessage?: string | null;
    sttMs?: number | null;
    retrievalMs?: number | null;
    llmMs?: number | null;
};

export async function updateVoiceTurn(
    voiceTurnId: string,
    patch: VoiceTurnPatch,
    db: ReturnType<typeof getDb> = getDb(),
) {
    await db.update(voiceTurns).set(patch).where(eq(voiceTurns.id, voiceTurnId));
}

/** A prior ready transcript for the same audio bytes — skips re-transcription. */
export async function findCachedTranscript(
    userId: string,
    audioHash: string,
    db: ReturnType<typeof getDb> = getDb(),
): Promise<string | null> {
    const rows = await db
        .select({ transcript: voiceTurns.transcript })
        .from(voiceTurns)
        .where(
            and(
                eq(voiceTurns.userId, userId),
                eq(voiceTurns.audioHash, audioHash),
                isNotNull(voiceTurns.transcript),
            ),
        )
        .limit(1);

    return rows[0]?.transcript ?? null;
}

/** Append a chat message from a trusted path (the voice worker). */
export async function insertMessage(
    row: { sessionId: string; userId: string; role: 'user' | 'assistant'; content: string },
    db: ReturnType<typeof getDb> = getDb(),
) {
    await db.insert(messages).values({
        sessionId: row.sessionId,
        userId: row.userId,
        role: row.role,
        content: row.content,
    });
}

/** Usage row per LLM call — Phase 2 observability (llm_usage table). */
export async function recordLlmUsage(
    row: {
        userId?: string | null;
        sessionId?: string | null;
        feature: 'chat' | 'quiz' | 'mindmap' | 'voice' | 'voice-stt';
        provider: string;
        model: string;
        inputTokens?: number | null;
        outputTokens?: number | null;
        costUsd?: string | null;
        ttftMs?: number | null;
        totalMs?: number | null;
        cacheHit?: boolean;
        fallbackUsed?: boolean;
    },
    db?: ReturnType<typeof getDb>,
) {
    try {
        // getDb() inside the try: a missing DATABASE_URL must never break the
        // request path — observability degrades to a log line.
        const client = db ?? getDb();
        await client.insert(llmUsage).values({
            userId: row.userId ?? null,
            sessionId: row.sessionId ?? null,
            feature: row.feature,
            provider: row.provider,
            model: row.model,
            inputTokens: row.inputTokens ?? null,
            outputTokens: row.outputTokens ?? null,
            costUsd: row.costUsd ?? null,
            ttftMs: row.ttftMs ?? null,
            totalMs: row.totalMs ?? null,
            cacheHit: row.cacheHit ?? false,
            fallbackUsed: row.fallbackUsed ?? false,
        });
    } catch (error) {
        // Observability must never break the request path
        logDocument.error('llm-usage', 'insert failed', error, { feature: row.feature });
    }
}
