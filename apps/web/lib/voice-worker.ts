import { Worker } from 'bullmq';
import { logDocument } from './logger';
import { loadEnvFiles } from './load-env';
import { createRedisConnection } from './redis';
import { callLlmChat, type ChatMessage, type LlmCallMeta } from './llm';
import { buildSystemPrompt } from './prompts';
import { retrieveContext } from './rag';
import {
    findCachedTranscript,
    insertMessage,
    recordLlmUsage,
    updateVoiceTurn,
    type VoiceTurnPatch,
} from './repository';
import { getServiceRoleSupabaseClient } from './supabase/api';
import type { VoiceJobData } from './voice-queue';

export const VOICE_BUCKET = 'voice-recordings';
export const WHISPER_MODEL = 'whisper-large-v3-turbo';
const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export type VoiceTranscription = {
    text: string;
    durationMs?: number;
    sttMs: number;
};

/** Injected so tests can run the loop without Storage, Groq, or Postgres. */
export type VoiceJobDeps = {
    findCachedTranscript(userId: string, audioHash: string): Promise<string | null>;
    downloadAudio(storagePath: string): Promise<{ buffer: Buffer; contentType: string }>;
    transcribe(buffer: Buffer, mimeType: string): Promise<VoiceTranscription>;
    retrieveContext(query: string, documentIds: string[], accessToken: string): Promise<string>;
    generateReply(
        messages: ChatMessage[],
        meta: { userId: string; sessionId: string },
    ): Promise<{ text: string; meta: LlmCallMeta }>;
    insertMessage(row: {
        sessionId: string;
        userId: string;
        role: 'user' | 'assistant';
        content: string;
    }): Promise<void>;
    updateVoiceTurn(voiceTurnId: string, patch: VoiceTurnPatch): Promise<void>;
    deleteAudio(storagePath: string): Promise<void>;
    recordUsage(row: Parameters<typeof recordLlmUsage>[0]): Promise<void>;
};

/**
 * One voice turn: transcript (STT, cached by audio hash) → RAG context →
 * Socratic reply → both persisted as chat messages. Retries shouldn't see a
 * half-written turn, so failures are surfaced (and marked) here.
 *
 * `finalAttempt` controls whether a failure flips the turn to `failed` (so the
 * polling client stops) or leaves it `processing` for BullMQ to retry.
 */
export async function handleVoiceJob(
    data: VoiceJobData,
    deps: VoiceJobDeps,
    opts: { finalAttempt?: boolean } = {},
): Promise<{ transcript: string; reply: string }> {
    const { voiceTurnId, userId, sessionId, documentIds, storagePath, audioHash, mimeType } = data;
    const startedAt = Date.now();

    logDocument.event('voice', 'job started', {
        voiceTurnId,
        sessionId,
        documentCount: documentIds.length,
    });

    try {
        await deps.updateVoiceTurn(voiceTurnId, { status: 'processing' });

        let transcript: string | null;
        let sttMs = 0;
        let cacheHit = false;

        const cached = await deps.findCachedTranscript(userId, audioHash);
        if (cached) {
            transcript = cached;
            cacheHit = true;
            logDocument.event('voice', 'transcript reused from cache', { voiceTurnId });
        } else {
            const { buffer, contentType } = await deps.downloadAudio(storagePath);
            logDocument.event('voice', 'audio downloaded', {
                voiceTurnId,
                bytes: buffer.byteLength,
            });

            const sttStartedAt = Date.now();
            const stt = await deps.transcribe(buffer, contentType || mimeType);
            sttMs = Date.now() - sttStartedAt;
            transcript = stt.text.trim();

            await deps.recordUsage({
                userId,
                sessionId,
                feature: 'voice-stt',
                provider: 'groq',
                model: WHISPER_MODEL,
                inputTokens: null,
                outputTokens: null,
                ttftMs: sttMs,
                totalMs: sttMs,
                fallbackUsed: false,
            });

            logDocument.event('voice', 'transcribed', {
                voiceTurnId,
                sttMs,
                durationMs: stt.durationMs,
                transcriptChars: transcript.length,
            });
        }

        if (!transcript) {
            throw new Error('Transcription returned no text.');
        }

        const retrievalStartedAt = Date.now();
        const context = await deps.retrieveContext(transcript, documentIds, data.userAccessToken);
        const retrievalMs = Date.now() - retrievalStartedAt;

        const messages: ChatMessage[] = [
            { role: 'system', content: buildSystemPrompt(context, undefined) },
            { role: 'user', content: transcript },
        ];

        const llmStartedAt = Date.now();
        const { text: reply, meta } = await deps.generateReply(messages, { userId, sessionId });
        const llmMs = Date.now() - llmStartedAt;

        if (!reply) {
            throw new Error('LLM returned an empty reply.');
        }

        // Same order as a text turn: user message then assistant reply
        await deps.insertMessage({ sessionId, userId, role: 'user', content: transcript });
        await deps.insertMessage({ sessionId, userId, role: 'assistant', content: reply });

        await deps.updateVoiceTurn(voiceTurnId, {
            status: 'ready',
            transcript,
            reply,
            sttMs,
            retrievalMs,
            llmMs,
        });

        // Privacy: drop the raw audio once the transcript + reply exist
        try {
            await deps.deleteAudio(storagePath);
        } catch (err) {
            logDocument.error('voice', 'audio delete failed', err, { voiceTurnId, storagePath });
        }

        logDocument.event('voice', 'turn complete', {
            voiceTurnId,
            sessionId,
            cache_hit: cacheHit,
            stt_ms: sttMs,
            retrieval_ms: retrievalMs,
            llm_ms: llmMs,
            llm_ttft_ms: meta.ttftMs,
            total_ms: Date.now() - startedAt,
            fallback_used: meta.fallbackUsed,
            transcript_chars: transcript.length,
        });

        return { transcript, reply };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logDocument.error('voice', 'job failed', err, {
            voiceTurnId,
            finalAttempt: opts.finalAttempt !== false,
            elapsedMs: Date.now() - startedAt,
        });

        if (opts.finalAttempt !== false) {
            try {
                await deps.updateVoiceTurn(voiceTurnId, { status: 'failed', errorMessage: message });
            } catch (statusError) {
                logDocument.error('voice', 'failed to mark turn failed', statusError, { voiceTurnId });
            }
        }

        throw err;
    }
}

// ── Groq Whisper (OpenAI-compatible multipart endpoint) ──────────────────────

export async function transcribeWithGroq(buffer: Buffer, mimeType: string): Promise<VoiceTranscription> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        throw new Error('GROQ_API_KEY is missing — required for voice transcription.');
    }

    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), 'audio.webm');
    form.append('model', WHISPER_MODEL);
    form.append('response_format', 'json');

    const startedAt = Date.now();
    const res = await fetch(GROQ_TRANSCRIBE_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
    });

    if (!res.ok) {
        throw new Error(`Groq transcription error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as { text?: string; duration?: number };
    return {
        text: data.text ?? '',
        durationMs: typeof data.duration === 'number' ? Math.round(data.duration * 1000) : undefined,
        sttMs: Date.now() - startedAt,
    };
}

// ── Production wiring ────────────────────────────────────────────────────────

function createVoiceDeps(): VoiceJobDeps {
    return {
        findCachedTranscript,
        insertMessage: (row) => insertMessage(row),
        updateVoiceTurn: (id, patch) => updateVoiceTurn(id, patch),
        recordUsage: (row) => recordLlmUsage(row),
        retrieveContext,
        transcribe: transcribeWithGroq,
        generateReply: (messages, meta) =>
            callLlmChat('voice', messages, { userId: meta.userId, sessionId: meta.sessionId }),

        async downloadAudio(storagePath) {
            const supabase = getServiceRoleSupabaseClient();
            const { data, error } = await supabase.storage.from(VOICE_BUCKET).download(storagePath);
            if (error || !data) {
                throw new Error(`Failed to download audio: ${error?.message ?? 'no data'}`);
            }

            return {
                buffer: Buffer.from(await data.arrayBuffer()),
                contentType: data.type || 'audio/webm',
            };
        },

        async deleteAudio(storagePath) {
            const supabase = getServiceRoleSupabaseClient();
            const { error } = await supabase.storage.from(VOICE_BUCKET).remove([storagePath]);
            if (error) throw new Error(error.message);
        },
    };
}

let voiceWorker: Worker<VoiceJobData> | undefined;

/** Second Worker in the same process (see lib/worker.ts). */
export function startVoiceWorker() {
    loadEnvFiles();

    voiceWorker ??= new Worker<VoiceJobData>(
        'voice-processing',
        (job) =>
            handleVoiceJob(job.data, createVoiceDeps(), {
                finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
            }),
        {
            connection: createRedisConnection(),
            concurrency: Number(process.env.VOICE_WORKER_CONCURRENCY ?? 2),
        },
    );

    voiceWorker.on('failed', (job, err) => {
        logDocument.error('voice', 'job failed event', err, {
            voiceTurnId: job?.data.voiceTurnId,
            jobId: job?.id,
            attemptsMade: job?.attemptsMade,
        });
    });

    voiceWorker.on('error', (err) => {
        logDocument.error('voice', 'worker error event', err);
    });

    logDocument.event('voice', 'worker started', {
        concurrency: Number(process.env.VOICE_WORKER_CONCURRENCY ?? 2),
    });

    return voiceWorker;
}
