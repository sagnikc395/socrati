import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import WebSocket from 'ws';
import { logDocument } from './logger';
import type { EmbeddedChunk } from './embedder';
import { loadEnvFiles } from './load-env';

// ── Public types ───────────────────────────────────────────────────────────

export type ParseStatus = 'pending' | 'processing' | 'ready' | 'failed';

type DbError = { message: string };

type DbTableRef = {
    insert(
        rows: Record<string, unknown> | Record<string, unknown>[],
    ): Promise<{ error: DbError | null }>;
    update(row: Record<string, unknown>): {
        eq(col: string, val: string): Promise<{ error: DbError | null }>;
    };
};

export type RepositoryClient = {
    from(table: string): DbTableRef;
};

export type RepositoryClientFactory = (accessToken?: string) => RepositoryClient;

// ── Supabase client helpers (used by the default factory) ─────────────────

let serviceClient: SupabaseClient | undefined;

const realtimeOptions = {
    transport: WebSocket as unknown as WebSocketLikeConstructor,
};

function getSupabaseUrl() {
    loadEnvFiles();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing.');
    return url;
}

function getServiceClient() {
    loadEnvFiles();
    if (serviceClient) return serviceClient;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is missing.');
    serviceClient = createClient(getSupabaseUrl(), key, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: realtimeOptions,
    });
    return serviceClient;
}

function getUserClient(accessToken: string): SupabaseClient {
    loadEnvFiles();
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing.');
    return createClient(getSupabaseUrl(), anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        realtime: realtimeOptions,
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
}

// ── Repository factory ─────────────────────────────────────────────────────
//
// Accepts an injectable client factory so callers (and tests) can supply
// their own Supabase client without touching module-level singletons.

export function createRepository(clientFactory: RepositoryClientFactory) {
    async function updateParseStatus(
        documentId: string,
        status: ParseStatus,
        errorMessage?: string,
        accessToken?: string,
    ) {
        logDocument.event('repository', 'updating parse status', {
            documentId,
            status,
            hasAccessToken: Boolean(accessToken),
        });

        const { error } = await clientFactory(accessToken)
            .from('documents')
            .update({ parse_status: status, error_message: errorMessage ?? null })
            .eq('document_id', documentId);

        if (error) {
            logDocument.error('repository', 'update parse status failed', error, {
                documentId,
                status,
            });
            throw new Error(`updateParseStatus failed: ${error.message}`);
        }

        logDocument.event('repository', 'parse status updated', { documentId, status });
    }

    async function saveChunksForUser(
        documentId: string,
        chunks: EmbeddedChunk[],
        accessToken?: string,
    ) {
        if (chunks.length === 0) return;

        logDocument.event('repository', 'saving chunks for user', {
            documentId,
            chunkCount: chunks.length,
            embeddingDimensions: chunks[0]?.embedding.length ?? 0,
        });

        const rows = chunks.map((chunk) => ({
            document_id: documentId,
            chunk_index: chunk.chunkIndex,
            content: chunk.content,
            heading: chunk.heading ?? null,
            key_terms: chunk.keyTerms,
            // pgvector requires a JSON string "[v1,v2,...]" — not a raw JS array.
            embedding: JSON.stringify(chunk.embedding),
        }));

        const { error } = await clientFactory(accessToken)
            .from('document_chunks')
            .insert(rows);

        if (error) {
            logDocument.error('repository', 'save chunks failed', error, {
                documentId,
                chunkCount: chunks.length,
            });
            throw new Error(`saveChunks failed: ${error.message}`);
        }

        logDocument.event('repository', 'chunks saved for user', {
            documentId,
            chunkCount: chunks.length,
        });
    }

    return { updateParseStatus, saveChunksForUser };
}

// ── Default module-level exports (use real Supabase clients) ───────────────
//
// Supabase returns PostgrestFilterBuilder (PromiseLike, not Promise), so we
// wrap the client to match the RepositoryClient interface.

function wrapSupabaseClient(supabase: SupabaseClient): RepositoryClient {
    return {
        from: (table) => supabase.from(table) as unknown as ReturnType<RepositoryClient['from']>,
    };
}

const defaultRepo = createRepository(
    (accessToken) =>
        wrapSupabaseClient(accessToken ? getUserClient(accessToken) : getServiceClient()),
);

export const updateParseStatus = defaultRepo.updateParseStatus;
export const saveChunksForUser = defaultRepo.saveChunksForUser;