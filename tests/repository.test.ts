import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTableName } from 'drizzle-orm';
import { updateParseStatus, saveChunks, getEmbeddingsByHash } from '../apps/web/lib/repository';
import type { EmbeddedChunk } from '../apps/web/lib/embedder';

// ── Console suppression ────────────────────────────────────────────────────

const originalConsole = { log: console.log, error: console.error };

// Minimal Drizzle-shaped stub: records calls, returns chainable builders.
type Call = { table: string; op: string; args: unknown };

function createMockDb(options: {
    insertError?: Error | null;
    updateError?: Error | null;
    selectError?: Error | null;
    existingRows?: { contentHash: string | null; embedding: string | null }[];
} = {}) {
    const calls: Call[] = [];

    const fail = (error?: Error | null) => {
        if (error) throw error;
    };

    const eq = (_col: unknown, _val: unknown) => '__eq__';

    const tableRef = (table: string) => ({
        set: (row: unknown) => {
            calls.push({ table, op: 'update', args: row });
            return {
                where: async (_w: unknown) => {
                    calls.push({ table, op: 'update.where', args: _w });
                    fail(options.updateError);
                },
            };
        },
        values: (rows: unknown) => {
            calls.push({ table, op: 'insert', args: rows });
            return Promise.resolve().then(() => fail(options.insertError));
        },
        where: (w: unknown) => {
            calls.push({ table, op: 'delete.where', args: w });
            return {
                returning: async () => {
                    fail(options.selectError);
                    return [];
                },
            };
        },
    });

    const db = {
        update: (table: object) => {
            const name = getTableName(table as Parameters<typeof getTableName>[0]);
            calls.push({ table: name, op: 'update', args: undefined });
            return tableRef(name);
        },
        insert: (table: object) => {
            const name = getTableName(table as Parameters<typeof getTableName>[0]);
            calls.push({ table: name, op: 'insert', args: undefined });
            return tableRef(name);
        },
        delete: (table: object) => {
            const name = getTableName(table as Parameters<typeof getTableName>[0]);
            calls.push({ table: name, op: 'delete', args: undefined });
            return {
                where: async (w: unknown) => {
                    calls.push({ table: name, op: 'delete.where', args: w });
                },
            };
        },
        select: (fields: unknown) => ({
            from: (_table: unknown) => ({
                where: async () => {
                    calls.push({ table: 'document_chunks', op: 'select', args: fields });
                    if (options.selectError) throw options.selectError;
                    return options.existingRows ?? [];
                },
            }),
        }),
    } as unknown as Parameters<typeof updateParseStatus>[3];

    return { db, calls };
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
        const { db, calls } = createMockDb();

        await updateParseStatus('doc-1', 'ready', undefined, db);

        const update = calls.find((c) => c.op === 'update' && c.args);
        assert.ok(update);
        assert.deepEqual(update.args, { parseStatus: 'ready', errorMessage: null });
        assert.equal(update.table, 'documents');
    });

    it('records an error message when marking failed', async () => {
        const { db, calls } = createMockDb();

        await updateParseStatus('doc-2', 'failed', 'embedding API timeout', db);

        const update = calls.find((c) => c.op === 'update' && c.args);
        assert.deepEqual(update?.args, { parseStatus: 'failed', errorMessage: 'embedding API timeout' });
    });

    it('wraps database errors with the operation name', async () => {
        const { db } = createMockDb({ updateError: new Error('connection refused') });

        await assert.rejects(
            () => updateParseStatus('doc-3', 'ready', undefined, db),
            /updateParseStatus failed: connection refused/,
        );
    });
});

// ── saveChunks ─────────────────────────────────────────────────────────────

describe('repository.saveChunks', () => {
    it('deletes stale rows then inserts one row per chunk with content hash', async () => {
        const { db, calls } = createMockDb();

        await saveChunks('doc-1', [makeChunk(0)], db);

        assert.ok(calls.some((c) => c.table === 'document_chunks' && c.op === 'delete.where'));
        const insert = calls.find((c) => c.op === 'insert' && c.args);
        assert.ok(insert);
        const rows = insert.args as Record<string, unknown>[];
        assert.equal(rows.length, 1);
        assert.equal(rows[0]!.documentId, 'doc-1');
        assert.equal(rows[0]!.chunkIndex, 0);
        assert.equal(rows[0]!.contentHash, null);
        // postgres-js serializes number[] into pgvector's text format
        assert.ok(Array.isArray(rows[0]!.embedding));
    });

    it('is a no-op for an empty chunk list', async () => {
        const { db, calls } = createMockDb();

        await saveChunks('doc-1', [], db);

        assert.equal(calls.length, 0);
    });

    it('wraps insert errors with the operation name', async () => {
        const { db } = createMockDb({ insertError: new Error('vector dimension mismatch') });

        await assert.rejects(
            () => saveChunks('doc-1', [makeChunk(0)], db),
            /saveChunks failed: vector dimension mismatch/,
        );
    });
});

// ── getEmbeddingsByHash ────────────────────────────────────────────────────

describe('repository.getEmbeddingsByHash', () => {
    it('parses pgvector text "[a,b,c]" into a hash-keyed vector map', async () => {
        const { db } = createMockDb({
            existingRows: [
                { contentHash: 'abc', embedding: '[0.1,0.2,0.3]' },
                { contentHash: null, embedding: '[0.4,0.5,0.6]' }, // skipped
            ],
        });

        const map = await getEmbeddingsByHash('doc-1', db);

        assert.deepEqual(map.get('abc'), [0.1, 0.2, 0.3]);
        assert.equal(map.size, 1);
    });

    it('returns an empty map when the document has no chunks', async () => {
        const { db } = createMockDb({ existingRows: [] });

        const map = await getEmbeddingsByHash('doc-1', db);

        assert.equal(map.size, 0);
    });
});
