import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleVoiceJob, type VoiceJobDeps } from '../apps/web/lib/voice-worker';
import type { VoiceJobData } from '../apps/web/lib/voice-queue';
import type { LlmCallMeta } from '../apps/web/lib/llm';
import type { VoiceTurnPatch } from '../apps/web/lib/repository';

const originalConsole = { log: console.log, error: console.error };

before(() => {
    console.log = () => {};
    console.error = () => {};
});

after(() => {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
});

const JOB: VoiceJobData = {
    voiceTurnId: 'turn-1',
    storagePath: 'user-1/turn-1.webm',
    mimeType: 'audio/webm',
    audioHash: 'hash-1',
    userId: 'user-1',
    sessionId: 'session-1',
    documentIds: ['doc-1'],
    userAccessToken: 'token-1',
};

const META: LlmCallMeta = {
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
    ttftMs: 200,
    totalMs: 400,
    fallbackUsed: false,
};

function createDeps(overrides: Partial<VoiceJobDeps> = {}) {
    const patches: { id: string; patch: VoiceTurnPatch }[] = [];
    const inserted: { role: string; content: string }[] = [];
    const usage: Record<string, unknown>[] = [];
    const deleted: string[] = [];
    let downloads = 0;
    let transcriptions = 0;

    const deps: VoiceJobDeps = {
        async findCachedTranscript() {
            return null;
        },
        async downloadAudio() {
            downloads += 1;
            return { buffer: Buffer.from('audio'), contentType: 'audio/webm' };
        },
        async transcribe() {
            transcriptions += 1;
            return { text: '  What is photosynthesis? ', sttMs: 120, durationMs: 3000 };
        },
        async retrieveContext() {
            return 'doc context';
        },
        async generateReply() {
            return { text: 'What do you think plants need to make food?', meta: META };
        },
        async insertMessage(row) {
            inserted.push({ role: row.role, content: row.content });
        },
        async updateVoiceTurn(id, patch) {
            patches.push({ id, patch });
        },
        async deleteAudio(storagePath) {
            deleted.push(storagePath);
        },
        async recordUsage(row) {
            usage.push(row as unknown as Record<string, unknown>);
        },
        ...overrides,
    };

    return {
        deps,
        patches,
        inserted,
        usage,
        deleted,
        get downloads() {
            return downloads;
        },
        get transcriptions() {
            return transcriptions;
        },
    };
}

describe('handleVoiceJob', () => {
    it('transcribes, retrieves, replies, persists messages, and marks ready', async () => {
        const fixture = createDeps();
        const result = await handleVoiceJob(JOB, fixture.deps);

        assert.deepEqual(result, {
            transcript: 'What is photosynthesis?',
            reply: 'What do you think plants need to make food?',
        });
        assert.equal(fixture.downloads, 1);
        assert.equal(fixture.transcriptions, 1);

        assert.deepEqual(fixture.inserted, [
            { role: 'user', content: 'What is photosynthesis?' },
            { role: 'assistant', content: 'What do you think plants need to make food?' },
        ]);

        // First processing, then ready with the persisted payload + timings
        assert.equal(fixture.patches[0]!.patch.status, 'processing');
        const ready = fixture.patches.at(-1)!.patch;
        assert.equal(ready.status, 'ready');
        assert.equal(ready.transcript, 'What is photosynthesis?');
        assert.equal(ready.reply, 'What do you think plants need to make food?');
        assert.ok(typeof ready.sttMs === 'number');
        assert.ok(typeof ready.retrievalMs === 'number');
        assert.ok(typeof ready.llmMs === 'number');

        assert.deepEqual(fixture.deleted, ['user-1/turn-1.webm']);
        assert.equal(fixture.usage.length, 1);
        assert.equal(fixture.usage[0]!.feature, 'voice-stt');
        assert.equal(fixture.usage[0]!.model, 'whisper-large-v3-turbo');
    });

    it('reuses a cached transcript and skips download, STT, and STT usage', async () => {
        const fixture = createDeps({
            async findCachedTranscript() {
                return 'cached transcript';
            },
        });

        const result = await handleVoiceJob(JOB, fixture.deps);

        assert.equal(result.transcript, 'cached transcript');
        assert.equal(fixture.downloads, 0);
        assert.equal(fixture.transcriptions, 0);
        assert.equal(fixture.usage.length, 0);
        assert.equal(fixture.patches.at(-1)!.patch.status, 'ready');
        assert.ok(fixture.deleted.includes('user-1/turn-1.webm'));
    });

    it('marks the turn failed on the final attempt and rethrows', async () => {
        const fixture = createDeps({
            async transcribe() {
                throw new Error('whisper exploded');
            },
        });

        await assert.rejects(() => handleVoiceJob(JOB, fixture.deps), /whisper exploded/);

        const failed = fixture.patches.at(-1)!.patch;
        assert.equal(failed.status, 'failed');
        assert.equal(failed.errorMessage, 'whisper exploded');
        assert.equal(fixture.inserted.length, 0);
    });

    it('leaves the turn processing when a retry is still pending', async () => {
        const fixture = createDeps({
            async transcribe() {
                throw new Error('temporary');
            },
        });

        await assert.rejects(
            () => handleVoiceJob(JOB, fixture.deps, { finalAttempt: false }),
            /temporary/,
        );

        assert.ok(fixture.patches.every((p) => p.patch.status !== 'failed'));
    });

    it('fails when transcription returns no text', async () => {
        const fixture = createDeps({
            async transcribe() {
                return { text: '   ', sttMs: 10 };
            },
        });

        await assert.rejects(() => handleVoiceJob(JOB, fixture.deps), /no text/);
        assert.equal(fixture.patches.at(-1)!.patch.status, 'failed');
    });

    it('still completes the turn when audio deletion fails', async () => {
        const fixture = createDeps({
            async deleteAudio() {
                throw new Error('storage down');
            },
        });

        const result = await handleVoiceJob(JOB, fixture.deps);

        assert.equal(result.reply.length > 0, true);
        assert.equal(fixture.patches.at(-1)!.patch.status, 'ready');
    });
});
