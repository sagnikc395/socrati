import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from './schema';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * Typed wrapper for the `match_document_chunks` RPC — kept as raw SQL on the
 * database (pgvector cosine search, hardened in migration 0011), typed here.
 *
 * Runs with the *connection's* Postgres role, so RLS does not scope it. Use
 * only from trusted server paths (worker, service jobs). User-facing retrieval
 * keeps going through rag.ts's Supabase client, which passes the caller's JWT
 * and lets RLS do the filtering.
 */
export async function matchDocumentChunks(
    db: Db,
    opts: {
        queryEmbedding: number[];
        matchCount: number;
        filterDocumentIds: string[];
    },
): Promise<{ chunkId: string; documentId: string; content: string; similarity: number }[]> {
    if (opts.filterDocumentIds.length === 0) return [];

    const rows = await db.execute(sql`
        select * from match_document_chunks(
            ${JSON.stringify(opts.queryEmbedding)}::vector,
            ${opts.matchCount},
            ${sql.raw(`array[${opts.filterDocumentIds.map((id) => `'${id}'`).join(',')}]::uuid[]`)}
        )
    `);

    return (rows as unknown as {
        chunk_id: string;
        document_id: string;
        content: string;
        similarity: number;
    }[]).map((r) => ({
        chunkId: r.chunk_id,
        documentId: r.document_id,
        content: r.content,
        similarity: Number(r.similarity),
    }));
}
