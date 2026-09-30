import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createRepository,
    type RepositoryClient,
    type RepositoryClientFactory,
} from '../apps/web/lib/repository';
import type { EmbeddedChunk } from '../apps/web/lib/embedder';

// ── Console suppression ────────────────────────────────────────────────────

const originalConsole = { log: console.log, error: console.error };

before(() => {
    console.log = () => {};
    console.error = () => {};
});

after(() => {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
});

// ── Mock factory helpers ───────────────────────────────────────────────────

type InsertedRow = Record<string, unknown>;
type UpdatedRow = { row: Record<string, unknown>; column: string; value: string };

type TableMockOptions = {
    insertError?: { message: string } | null;
    updateError?: { message: string } | null;
};

function createMockFactory(opts: Record<string, TableMockOptions> = {}): {
    factory: RepositoryClientFactory;
    inserts: Record<string, InsertedRow[]>;
    updates: Record<string, UpdatedRow[]>;
    capturedTokens: (string | undefined)[];
} {
    const inserts: Record<string, InsertedRow[]> = {};
    const updates: Record<string, UpdatedRow[]> = {};
    const capturedTokens: (string | undefined)[] = [];

    const factory: RepositoryClientFactory = (accessToken) => {
        capturedTokens.push(accessToken);

        const client: RepositoryClient = {
            from(table) {
                inserts[table] ??= [];
                updates[table] ??= [];

                const tableOpts = opts[table] ?? {};

                return {
                    async insert(rows) {
                        const arr = Array.isArray(rows) ? rows : [rows];
                        inserts[table]!.push(...arr);
                        return { error: tableOpts.insertError ?? null };
                    },
                    update(row) {
                        return {
                            async eq(col, val) {
                                updates[table]!.push({ row, column: col, value: val });
                                return { error: tableOpts.updateError ?? null };
                            },
                        };
                    },
                };
            },
        };

        return client;
    };

    return { factory, inserts, updates, capturedTokens };
}

function makeChunk(index: number, embeddingSize = 3): EmbeddedChunk {
    return {
        chunkIndex: index,
        content: `chunk content ${index}`,
        heading: index === 0 ? 'Introduction' : null,
        keyTerms: ['term1', 'term2'],
        embedding: Array.from({ length: embeddingSize }, (_, i) => (i + 1) * 0.1),
    };
}

// ── updateParseStatus ──────────────────────────────────────────────────────

describe('repository.updateParseStatus', () => {
    it('updates parse_status on the documents table', async () => {
        const { factory, updates } = createMockFactory();
        const repo = createRepository(factory);

        await repo.updateParseStatus('doc-1', 'ready');

        assert.equal(updates['documents']?.length, 1);
        assert.deepEqual(updates['documents']![0], {
            row: { parse_status: 'ready', error_message: null },
            column: 'document_id',
            value: 'doc-1',
        });
    });

    it('includes error_message when provided', async () => {
        const { factory, updates } = createMockFactory();
        const repo = createRepository(factory);

        await repo.updateParseStatus('doc-2', 'failed', 'embedding API timeout');

        assert.deepEqual(updates['documents']![0]!.row, {
            parse_status: 'failed',
            error_message: 'embedding API timeout',
        });
    });

    it('passes the access token to the client factory', async () => {
        const { factory, capturedTokens } = createMockFactory();
        const repo = createRepository(factory);

        await repo.updateParseStatus('doc-3', 'processing', undefined, 'user-token-abc');

        assert.equal(capturedTokens[0], 'user-token-abc');
    });

    it('throws when the database returns an error', async () => {
        const { factory } = createMockFactory({
            documents: { updateError: { message: 'connection refused' } },
        });
        const repo = createRepository(factory);

        await assert.rejects(
            () => repo.updateParseStatus('doc-4', 'ready'),
            /updateParseStatus failed: connection refused/,
        );
    });
});

// ── saveChunksForUser ──────────────────────────────────────────────────────

describe('repository.saveChunksForUser', () => {
    it('inserts all chunks into document_chunks', async () => {
        const { factory, inserts } = createMockFactory();
        const repo = createRepository(factory);

        const chunks = [makeChunk(0), makeChunk(1)];
        await repo.saveChunksForUser('doc-1', chunks, 'user-token');

        assert.equal(inserts['document_chunks']?.length, 2);
    });

    it('serialises embeddings as a JSON string for pgvector', async () => {
        const { factory, inserts } = createMockFactory();
        const repo = createRepository(factory);

        const chunks = [makeChunk(0, 3)];
        await repo.saveChunksForUser('doc-1', chunks, 'user-token');

        const row = inserts['document_chunks']![0]!;
        assert.equal(typeof row['embedding'], 'string');
        assert.equal(row['embedding'], '[0.1,0.2,0.30000000000000004]');
    });

    it('maps chunk fields to the correct column names', async () => {
        const { factory, inserts } = createMockFactory();
        const repo = createRepository(factory);

        await repo.saveChunksForUser('doc-99', [makeChunk(0)], 'token');

        const row = inserts['document_chunks']![0]!;
        assert.equal(row['document_id'], 'doc-99');
        assert.equal(row['chunk_index'], 0);
        assert.equal(row['content'], 'chunk content 0');
        assert.equal(row['heading'], 'Introduction');
        assert.deepEqual(row['key_terms'], ['term1', 'term2']);
    });

    it('stores null heading when chunk has no heading', async () => {
        const { factory, inserts } = createMockFactory();
        const repo = createRepository(factory);

        await repo.saveChunksForUser('doc-1', [makeChunk(1)], 'token');

        assert.equal(inserts['document_chunks']![0]!['heading'], null);
    });

    it('is a no-op when the chunk list is empty', async () => {
        const { factory, inserts, capturedTokens } = createMockFactory();
        const repo = createRepository(factory);

        await repo.saveChunksForUser('doc-1', [], 'token');

        assert.equal(inserts['document_chunks']?.length ?? 0, 0);
        assert.equal(capturedTokens.length, 0);
    });

    it('passes the access token to the client factory', async () => {
        const { factory, capturedTokens } = createMockFactory();
        const repo = createRepository(factory);

        await repo.saveChunksForUser('doc-1', [makeChunk(0)], 'my-user-token');

        assert.equal(capturedTokens[0], 'my-user-token');
    });

    it('throws when the database returns an error', async () => {
        const { factory } = createMockFactory({
            document_chunks: { insertError: { message: 'vector dimension mismatch' } },
        });
        const repo = createRepository(factory);

        await assert.rejects(
            () => repo.saveChunksForUser('doc-1', [makeChunk(0)], 'token'),
            /saveChunks failed: vector dimension mismatch/,
        );
    });
});
