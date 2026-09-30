import { describe, it, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { contentHash, embedChunksWithReuse } from '../apps/web/lib/embedder';
import type { Chunk } from '../apps/web/lib/chunker';

function chunk(content: string, index: number): Chunk {
    return { content, chunkIndex: index, keyTerms: [], heading: null };
}

describe('embedChunksWithReuse', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('reuses cached embeddings without calling the API', async () => {
        const hash = contentHash('identical text');
        const cached = new Map([[hash, Array(1536).fill(0.5)]]);

        const fetchSpy = mock.method(global, 'fetch', async () => {
            throw new Error('API must not be called when everything is cached');
        });

        const { embedded, reused } = await embedChunksWithReuse(
            [chunk('identical text', 0)],
            cached,
        );

        assert.equal(reused, 1);
        assert.equal(embedded[0]!.embedding.length, 1536);
        assert.deepEqual(embedded[0]!.embedding, Array(1536).fill(0.5));
        assert.equal(embedded[0]!.contentHash, hash);
        fetchSpy.mock.restore();
    });

    it('embeds only cache misses and mixes in the cached hits', async () => {
        process.env.EMBEDDING_MOCK = 'true';
        const hitHash = contentHash('cached text');
        const cached = new Map([[hitHash, Array(1536).fill(0.25)]]);

        const { embedded, reused } = await embedChunksWithReuse(
            [chunk('cached text', 0), chunk('fresh text', 1)],
            cached,
        );

        assert.equal(reused, 1);
        assert.equal(embedded.length, 2);
        assert.deepEqual(embedded[0]!.embedding, Array(1536).fill(0.25));
        assert.equal(embedded[1]!.embedding.length, 1536, 'miss gets a fresh (mock) embedding');
        assert.notEqual(embedded[1]!.contentHash, hitHash);
        delete process.env.EMBEDDING_MOCK;
    });

    it('embeds everything when the cache is empty', async () => {
        process.env.EMBEDDING_MOCK = 'true';

        const { embedded, reused } = await embedChunksWithReuse(
            [chunk('a', 0), chunk('b', 1)],
            new Map(),
        );

        assert.equal(reused, 0);
        assert.equal(embedded.length, 2);
        delete process.env.EMBEDDING_MOCK;
    });

    it('returns empty for no chunks', async () => {
        const { embedded, reused } = await embedChunksWithReuse([], new Map());
        assert.equal(embedded.length, 0);
        assert.equal(reused, 0);
    });

    it('contentHash is stable and content-sensitive', () => {
        assert.equal(contentHash('abc'), contentHash('abc'));
        assert.notEqual(contentHash('abc'), contentHash('abd'));
    });
});
