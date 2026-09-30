import { createHash } from 'node:crypto';
import { logDocument } from './logger';
import { VOICE_BUCKET } from './voice-worker';
import type { VoiceJobData } from './voice-queue';

type SupabaseError = { message: string };

type SupabaseClientLike = {
    auth: {
        getUser(): Promise<{
            data: { user: { id: string } | null };
            error?: SupabaseError | null;
        }>;
        getSession(): Promise<{
            data: { session: { access_token: string } | null };
        }>;
    };
    from(table: string): {
        insert(row: Record<string, unknown>): PromiseLike<{ error: SupabaseError | null }>;
        update(row: Record<string, unknown>): {
            eq(column: string, value: string): PromiseLike<{ error: SupabaseError | null }>;
        };
    };
    storage: {
        from(bucket: string): {
            upload(
                path: string,
                file: Buffer,
                options?: { contentType?: string; upsert?: boolean },
            ): PromiseLike<{ error: SupabaseError | null }>;
        };
    };
};

type VoiceQueueLike = {
    add(name: string, data: VoiceJobData): Promise<{ id?: string }>;
};

export type VoiceUploadDependencies = {
    createSupabaseClient(): Promise<SupabaseClientLike>;
    getVoiceQueue(): VoiceQueueLike;
    checkRateLimit(
        userId: string,
        limit?: number,
        windowSec?: number,
    ): Promise<{ allowed: boolean; retryAfterSec: number }>;
    generateVoiceTurnId(): string;
};

// Caps — kept server-side; the recorder enforces them client-side too.
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_DURATION_MS = 120_000; // 120 s
export const VOICE_RATE_LIMIT = 10; // per minute
export const VOICE_MIME_ALLOWLIST = [
    'audio/webm',
    'audio/mp3',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/ogg',
    'audio/m4a',
    'audio/x-m4a',
    'audio/mp4',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extensionFor(mimeType: string) {
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('ogg')) return 'ogg';
    if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
    if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return 'mp3';
    return 'webm';
}

/** documentIds may arrive as repeated fields or one JSON array string. */
function parseDocumentIds(formData: FormData): string[] {
    const raw = formData.getAll('documentIds');
    const expanded = raw.flatMap((value) => {
        if (typeof value !== 'string') return [];
        const trimmed = value.trim();
        if (trimmed.startsWith('[')) {
            try {
                const parsed = JSON.parse(trimmed);
                return Array.isArray(parsed) ? parsed.map(String) : [];
            } catch {
                return [];
            }
        }
        return [trimmed];
    });

    return expanded.filter((id) => UUID_RE.test(id));
}

export async function handleVoiceUpload(req: Request, deps: VoiceUploadDependencies) {
    const startedAt = Date.now();
    let voiceTurnId: string | undefined;
    let storagePath: string | undefined;

    try {
        const supabase = await deps.createSupabaseClient();
        const {
            data: { user },
            error: authError,
        } = await supabase.auth.getUser();
        const {
            data: { session },
        } = await supabase.auth.getSession();

        if (authError || !user || !session?.access_token) {
            return Response.json({ message: 'Unauthorized' }, { status: 401 });
        }

        // Stricter than chat: 10 voice uploads/min per user
        const rl = await deps.checkRateLimit(user.id, VOICE_RATE_LIMIT, 60);
        if (!rl.allowed) {
            logDocument.event('voice', 'upload rate limited', {
                userId: user.id,
                retryAfterSec: rl.retryAfterSec,
            });
            return Response.json(
                { message: 'Too many voice requests. Please slow down.' },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
            );
        }

        const formData = await req.formData();
        const audio = formData.get('audio');
        const sessionId = formData.get('sessionId');

        if (!audio || typeof audio === 'string') {
            return Response.json({ message: 'No audio provided' }, { status: 400 });
        }

        if (typeof sessionId !== 'string' || !UUID_RE.test(sessionId)) {
            return Response.json({ message: 'sessionId must be a valid UUID' }, { status: 400 });
        }

        const mimeType = audio.type || 'audio/webm';
        if (!VOICE_MIME_ALLOWLIST.includes(mimeType)) {
            return Response.json({ message: `Unsupported audio type: ${mimeType}` }, { status: 400 });
        }

        if (audio.size > MAX_AUDIO_BYTES) {
            return Response.json({ message: 'Audio exceeds the 10 MB limit' }, { status: 400 });
        }

        const durationRaw = formData.get('durationMs');
        const durationMs = typeof durationRaw === 'string' ? Number(durationRaw) : undefined;
        if (durationMs !== undefined && (!Number.isFinite(durationMs) || durationMs > MAX_DURATION_MS)) {
            return Response.json({ message: 'Audio exceeds the 120 s limit' }, { status: 400 });
        }

        const documentIds = parseDocumentIds(formData);
        const buffer = Buffer.from(await audio.arrayBuffer());
        const audioHash = createHash('sha256').update(buffer).digest('hex');

        voiceTurnId = deps.generateVoiceTurnId();
        storagePath = `${user.id}/${voiceTurnId}.${extensionFor(mimeType)}`;

        logDocument.event('voice', 'upload received', {
            voiceTurnId,
            userId: user.id,
            sessionId,
            mimeType,
            bytes: buffer.byteLength,
            documentCount: documentIds.length,
        });

        const { error: uploadError } = await supabase.storage
            .from(VOICE_BUCKET)
            .upload(storagePath, buffer, { contentType: mimeType, upsert: false });

        if (uploadError) {
            logDocument.error('voice', 'audio upload failed', uploadError, { voiceTurnId });
            throw new Error(`uploadAudio failed: ${uploadError.message}`);
        }

        const { error: insertError } = await supabase.from('voice_turns').insert({
            id: voiceTurnId,
            session_id: sessionId,
            user_id: user.id,
            storage_path: storagePath,
            mime_type: mimeType,
            duration_ms: durationMs ?? null,
            status: 'pending',
            audio_hash: audioHash,
        });

        if (insertError) {
            logDocument.error('voice', 'voice_turn insert failed', insertError, { voiceTurnId });
            throw new Error(`createVoiceTurn failed: ${insertError.message}`);
        }

        try {
            const job = await deps.getVoiceQueue().add('process-voice', {
                voiceTurnId,
                storagePath,
                mimeType,
                audioHash,
                userId: user.id,
                sessionId,
                documentIds,
                userAccessToken: session.access_token,
            });

            logDocument.event('voice', 'job enqueued', {
                voiceTurnId,
                jobId: job.id,
                elapsedMs: Date.now() - startedAt,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Failed to enqueue voice job';
            logDocument.error('voice', 'job enqueue failed', err, { voiceTurnId });

            await supabase
                .from('voice_turns')
                .update({ status: 'failed', error_message: msg })
                .eq('id', voiceTurnId);
            throw err;
        }

        return Response.json({ voiceTurnId });
    } catch (err) {
        const msg = err instanceof Error ? err.message : 'Voice upload failed';
        logDocument.error('voice', 'upload request failed', err, {
            voiceTurnId,
            elapsedMs: Date.now() - startedAt,
        });
        return Response.json({ message: msg }, { status: 500 });
    }
}
