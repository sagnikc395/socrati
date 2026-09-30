import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../apps/web/lib/logger';

function captureConsole(method: 'log' | 'error'): { lines: string[]; restore: () => void } {
    const lines: string[] = [];
    const spy = mock.method(console, method, (...args: unknown[]) => {
        lines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    });
    return { lines, restore: () => spy.mock.restore() };
}

describe('logger', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('bind() attaches requestId to every event line', () => {
        const { lines } = captureConsole('log');

        const log = createLogger('test').bind({ requestId: 'req-1' });
        log.event('scope', 'hello', { extra: 1 });
        log.event('scope', 'no fields');

        assert.equal(lines.length, 2);
        assert.match(lines[0]!, /requestId/);
        assert.match(lines[0]!, /req-1/);
        assert.match(lines[0]!, /extra/);
        assert.match(lines[1]!, /requestId/);
        assert.match(lines[1]!, /req-1/);
    });

    it('bind() attaches jobId to error lines including Error fields', () => {
        const { lines } = captureConsole('error');

        const log = createLogger('test').bind({ jobId: 'job-9' });
        log.error('scope', 'failed', new Error('boom'), { docId: 'd1' });

        assert.match(lines[0]!, /jobId/);
        assert.match(lines[0]!, /job-9/);
        assert.match(lines[0]!, /errorMessage.*boom/);
        assert.match(lines[0]!, /docId/);
    });

    it('redacts token/key/secret/password fields', () => {
        const { lines } = captureConsole('log');

        createLogger('test').event('auth', 'request', {
            accessToken: 'secret-jwt',
            apiKey: 'k-123',
            userId: 'visible',
        });

        assert.match(lines[0]!, /accessToken.*\[redacted\]/);
        assert.match(lines[0]!, /apiKey.*\[redacted\]/);
        assert.match(lines[0]!, /userId.*visible/);
        assert.doesNotMatch(lines[0]!, /secret-jwt/);
        assert.doesNotMatch(lines[0]!, /k-123/);
    });

    it('error() accepts fields-only shape (no Error)', () => {
        const { lines } = captureConsole('error');

        createLogger('test').error('chat', 'rate limited', { userId: 'u1' });

        assert.match(lines[0]!, /rate limited/);
        assert.match(lines[0]!, /u1/);
    });

    it('unbound logger produces clean lines without context fields', () => {
        const { lines } = captureConsole('log');

        createLogger('plain').event('x', 'message only');

        assert.match(lines[0]!, /^\[plain:x\] message only/);
    });
});
