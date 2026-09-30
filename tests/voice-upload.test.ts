import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { File } from 'node:buffer';
import {
    MAX_AUDIO_BYTES,
    handleVoiceUpload,
    type VoiceUploadDependencies,
} from '../apps/web/lib/voice-upload';

const originalConsole = { log: console.log, error: console.error };

before(() => {
    console.log = () => {};
    console.error = () => {};
});

after(() => {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
});

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const DOC_ID = '22222222-2222-4222-8222-222222222222';

function createVoiceRequest(
    options: {
        audio?: File;
        sessionId?: string | null;
        documentIds?: string[];
        durationMs?: number;
    } = {},
) {
    const form = new FormData();
    if (options.audio !== undefined) form.append('audio', options.audio);
    const sessionId = options.sessionId === undefined ? SESSION_ID : options.sessionId;
    if (sessionId !== null) form.append('sessionId', sessionId);
    if (options.documentIds) form.append('documentIds', JSON.stringify(options.documentIds));
    if (options.durationMs !== undefined) form.append('durationMs', String(options.durationMs));

    return new Request('http://localhost/api/voice', { method: 'POST', body: form });
}

function createAudio(content = 'fake audio bytes', type = 'audio/webm') {
    return new File([content], 'recording.webm', { type });
}

function createDeps(options?: {
    user?: { id: string } | null;
    session?: { access_token: string } | null;
    uploadError?: { message: string } | null;
    insertError?: { message: string } | null;
    enqueueError?: Error;
    allowed?: boolean;
}) {
    const uploads: { path: string; bytes: number; contentType?: string }[] = [];
    const inserts: Record<string, unknown>[] = [];
    const updates: Record<string, unknown>[] = [];
    const jobs: unknown[] = [];

    const deps: VoiceUploadDependencies = {
        async createSupabaseClient() {
            return {
                auth: {
                    async getUser() {
                        return {
                            data: {
                                user:
                                    options && 'user' in options
                                        ? options.user!
                                        : { id: 'user-123' },
                            },
                            error: null,
                        };
                    },
                    async getSession() {
                        return {
                            data: {
                                session:
                                    options && 'session' in options
                                        ? options.session!
                                        : { access_token: 'access-token-123' },
                            },
                        };
                    },
                },
                from(table: string) {
                    return {
                        async insert(row: Record<string, unknown>) {
                            inserts.push({ table, ...row });
                            return { error: options?.insertError ?? null };
                        },
                        update(row: Record<string, unknown>) {
                            return {
                                async eq(column: string, value: string) {
                                    updates.push({ table, row, column, value });
                                    return { error: null };
                                },
                            };
                        },
                    };
                },
                storage: {
                    from(bucket: string) {
                        return {
                            async upload(path: string, file: Buffer, uploadOptions?: { contentType?: string }) {
                                uploads.push({ path: `${bucket}/${path}`, bytes: file.byteLength, contentType: uploadOptions?.contentType });
                                return { error: options?.uploadError ?? null };
                            },
                        };
                    },
                },
            };
        },
        getVoiceQueue() {
            return {
                async add(_name: string, data: unknown) {
                    if (options?.enqueueError) throw options.enqueueError;
                    jobs.push(data);
                    return { id: 'job-1' };
                },
            };
        },
        async checkRateLimit() {
            return { allowed: options?.allowed ?? true, retryAfterSec: options?.allowed === false ? 42 : 0 };
        },
        generateVoiceTurnId() {
            return 'turn-123';
        },
    };

    return { deps, uploads, inserts, updates, jobs };
}

async function readJson(response: Response) {
    return (await response.json()) as Record<string, unknown>;
}

describe('handleVoiceUpload', () => {
    it('stores audio, inserts a pending turn, and enqueues the job', async () => {
        const fixture = createDeps();
        const response = await handleVoiceUpload(
            createVoiceRequest({ audio: createAudio(), documentIds: [DOC_ID], durationMs: 4200 }),
            fixture.deps,
        );

        assert.equal(response.status, 200);
        assert.deepEqual(await readJson(response), { voiceTurnId: 'turn-123' });

        assert.equal(fixture.uploads.length, 1);
        assert.equal(fixture.uploads[0]!.path, 'voice-recordings/user-123/turn-123.webm');
        assert.equal(fixture.uploads[0]!.contentType, 'audio/webm');

        assert.equal(fixture.inserts.length, 1);
        assert.equal(fixture.inserts[0]!.table, 'voice_turns');
        assert.equal(fixture.inserts[0]!.status, 'pending');
        assert.equal(fixture.inserts[0]!.session_id, SESSION_ID);
        assert.equal(fixture.inserts[0]!.user_id, 'user-123');
        assert.equal(
            fixture.inserts[0]!.audio_hash,
            createHash('sha256').update(Buffer.from('fake audio bytes')).digest('hex'),
        );

        assert.equal(fixture.jobs.length, 1);
        assert.deepEqual(fixture.jobs[0], {
            voiceTurnId: 'turn-123',
            storagePath: 'user-123/turn-123.webm',
            mimeType: 'audio/webm',
            audioHash: fixture.inserts[0]!.audio_hash,
            userId: 'user-123',
            sessionId: SESSION_ID,
            documentIds: [DOC_ID],
            userAccessToken: 'access-token-123',
        });
    });

    it('returns 401 without touching storage or the queue when unauthenticated', async () => {
        const fixture = createDeps({ user: null, session: null });
        const response = await handleVoiceUpload(createVoiceRequest({ audio: createAudio() }), fixture.deps);

        assert.equal(response.status, 401);
        assert.deepEqual(fixture.uploads, []);
        assert.deepEqual(fixture.inserts, []);
        assert.deepEqual(fixture.jobs, []);
    });

    it('returns 429 when the rate limit is exceeded', async () => {
        const fixture = createDeps({ allowed: false });
        const response = await handleVoiceUpload(createVoiceRequest({ audio: createAudio() }), fixture.deps);

        assert.equal(response.status, 429);
        assert.equal(response.headers.get('Retry-After'), '42');
        assert.deepEqual(fixture.uploads, []);
        assert.deepEqual(fixture.jobs, []);
    });

    it('returns 400 when no audio is provided', async () => {
        const fixture = createDeps();
        const response = await handleVoiceUpload(createVoiceRequest(), fixture.deps);

        assert.equal(response.status, 400);
        assert.deepEqual(fixture.uploads, []);
    });

    it('returns 400 for a non-UUID sessionId', async () => {
        const fixture = createDeps();
        const response = await handleVoiceUpload(
            createVoiceRequest({ audio: createAudio(), sessionId: 'not-a-uuid' }),
            fixture.deps,
        );

        assert.equal(response.status, 400);
        assert.deepEqual(fixture.uploads, []);
    });

    it('returns 400 for an unsupported audio type', async () => {
        const fixture = createDeps();
        const response = await handleVoiceUpload(
            createVoiceRequest({ audio: createAudio('x', 'audio/flac') }),
            fixture.deps,
        );

        assert.equal(response.status, 400);
        assert.deepEqual(fixture.uploads, []);
    });

    it('returns 400 when the audio exceeds the size cap', async () => {
        const fixture = createDeps();
        const bigFile = new File([Buffer.alloc(MAX_AUDIO_BYTES + 1)], 'big.webm', { type: 'audio/webm' });
        const response = await handleVoiceUpload(createVoiceRequest({ audio: bigFile }), fixture.deps);

        assert.equal(response.status, 400);
        assert.deepEqual(fixture.uploads, []);
    });

    it('returns 400 when the duration exceeds the cap', async () => {
        const fixture = createDeps();
        const response = await handleVoiceUpload(
            createVoiceRequest({ audio: createAudio(), durationMs: 120_001 }),
            fixture.deps,
        );

        assert.equal(response.status, 400);
        assert.deepEqual(fixture.uploads, []);
    });

    it('marks the turn failed when enqueueing fails', async () => {
        const fixture = createDeps({ enqueueError: new Error('Redis unavailable') });
        const response = await handleVoiceUpload(createVoiceRequest({ audio: createAudio() }), fixture.deps);

        assert.equal(response.status, 500);
        assert.deepEqual(await readJson(response), { message: 'Redis unavailable' });
        assert.deepEqual(fixture.updates, [
            {
                table: 'voice_turns',
                row: { status: 'failed', error_message: 'Redis unavailable' },
                column: 'id',
                value: 'turn-123',
            },
        ]);
    });
});
