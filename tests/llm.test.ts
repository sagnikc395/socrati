import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { callLlmJson, isCircuitOpen, resetCircuitBreaker, type LlmCallMeta } from '../apps/web/lib/llm';

type FetchCall = { url: string; body: { model: string } };

function groqOk(model: string, content: string) {
    return {
        ok: true,
        json: async () => ({
            choices: [{ message: { content } }],
            usage: { prompt_tokens: 11, completion_tokens: 22 },
        }),
    };
}

/** fetch that fails the primary (8b) model and answers on the fallback (70b). */
function mockFetch(failPrimary: boolean, content = '{"ok":true}') {
    const calls: FetchCall[] = [];
    const fn = (async (url: unknown, init?: { body?: string }) => {
        const body = JSON.parse(init?.body ?? '{}') as { model: string };
        calls.push({ url: String(url), body });
        if (failPrimary && body.model === 'llama-3.1-8b-instant') {
            return { ok: false, text: async () => 'primary down' } as Response;
        }
        return groqOk(body.model, content) as unknown as Response;
    }) as typeof fetch;
    return { fn, calls };
}

const recorded: Record<string, unknown>[] = [];
const recordStub = async (row: Record<string, unknown>) => {
    recorded.push(row);
};

describe('callLlmJson', () => {
    afterEach(() => {
        resetCircuitBreaker();
        recorded.length = 0;
    });

    it('uses the primary model on success and returns parsed JSON + meta', async () => {
        const { fn, calls } = mockFetch(false);
        const { parsed, meta } = await callLlmJson(
            'quiz',
            'p',
            {},
            { fetchFn: fn, recordUsage: recordStub, now: () => 1000 },
        );

        assert.deepEqual(parsed, { ok: true });
        assert.equal(meta.provider, 'groq');
        assert.equal(meta.model, 'llama-3.1-8b-instant');
        assert.equal(meta.fallbackUsed, false);
        assert.equal(meta.inputTokens, 11);
        assert.equal(meta.outputTokens, 22);
        assert.equal(calls.length, 1);
    });

    it('falls back to the larger model when the primary fails', async () => {
        const { fn, calls } = mockFetch(true);
        const { meta } = await callLlmJson(
            'chat',
            'p',
            {},
            { fetchFn: fn, recordUsage: recordStub, now: () => 1000 },
        );

        assert.equal(meta.provider, 'fallback');
        assert.equal(meta.model, 'llama-3.3-70b-versatile');
        assert.equal(meta.fallbackUsed, true);
        assert.equal(calls.length, 2, 'should have tried primary then fallback');
        assert.equal(recorded.length, 1);
        assert.equal(recorded[0]!.fallbackUsed, true);
    });

    it('throws (and records fallback_used=false) when both models fail', async () => {
        const fn = (async (_url: unknown) =>
            ({ ok: false, text: async () => 'down' }) as unknown as Response) as typeof fetch;

        await assert.rejects(
            () => callLlmJson('quiz', 'p', {}, { fetchFn: fn, recordUsage: recordStub, now: () => 1000 }),
            /Groq API error/,
        );
        assert.equal(recorded.length, 1);
        assert.equal(recorded[0]!.fallbackUsed, false);
    });

    it('opens the circuit after 3 consecutive total failures, then skips the primary', async () => {
        const fn = (async (_url: unknown) =>
            ({ ok: false, text: async () => 'down' }) as unknown as Response) as typeof fetch;
        const opts = { fetchFn: fn, recordUsage: recordStub, now: () => 1000 };

        for (let i = 0; i < 3; i++) {
            await assert.rejects(() => callLlmJson('quiz', 'p', {}, opts));
        }
        assert.equal(isCircuitOpen(1000), true, 'breaker should be open at 1000');

        // While open: only the fallback model is attempted
        const { fn: spyFn, calls } = mockFetch(false);
        await callLlmJson('quiz', 'p', {}, { fetchFn: spyFn, recordUsage: recordStub, now: () => 2000 });
        assert.equal(calls.length, 1);
        assert.equal(calls[0]!.body.model, 'llama-3.3-70b-versatile');

        // Half-open after 30s
        assert.equal(isCircuitOpen(31_000), false);
    });

    it('throws on invalid JSON from a successful response', async () => {
        const { fn } = mockFetch(false, 'not json at all');
        await assert.rejects(
            () => callLlmJson('mindmap', 'p', {}, { fetchFn: fn, recordUsage: recordStub, now: () => 1000 }),
            /invalid JSON/,
        );
    });

    it('strips markdown fences before parsing', async () => {
        const { fn } = mockFetch(false, '```json\n{"a":1}\n```');
        const { parsed } = await callLlmJson('quiz', 'p', {}, { fetchFn: fn, recordUsage: recordStub, now: () => 1000 });
        assert.deepEqual(parsed, { a: 1 });
    });

    it('records a usage row with timings', async () => {
        const { fn } = mockFetch(false);
        let clock = 1000;
        const { meta } = await callLlmJson(
            'chat',
            'p',
            { userId: 'u1', sessionId: 's1' },
            { fetchFn: fn, recordUsage: recordStub, now: () => ++clock * 10 },
        );

        assert.ok(meta.totalMs >= 0);
        assert.equal(recorded.length, 1);
        assert.equal(recorded[0]!.feature, 'chat');
        assert.equal(recorded[0]!.userId, 'u1');
        assert.equal(recorded[0]!.sessionId, 's1');
        assert.equal(recorded[0]!.provider, 'groq');
    });
});
