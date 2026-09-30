import { createClient } from '@supabase/supabase-js';
import * as embedder from './embedder';
import { loadEnvFiles } from './load-env';

/**
 * Initializes a secure Supabase client.
 * If an accessToken is provided, it acts on behalf of the user (RLS enforced).
 */
export function getSupabaseClient(accessToken?: string) {
    loadEnvFiles();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing.');

    if (accessToken) {
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing.');
        return createClient(url, anonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
            global: { headers: { Authorization: `Bearer ${accessToken}` } },
        });
    } else {
        // No token provided — intentional for trusted server-side callers (e.g. API routes)
        // that have already verified the user's identity via cookies/session separately.
        // RLS policies still apply: an unauthenticated anon client will return 0 rows
        // for protected tables, so always pass accessToken in production code paths.
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is missing.');
        return createClient(url, anonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
        });
    }
}

/**
 * Retrieves the most semantically relevant textbook chunks for a given query.
 * 
 * @param query The user's chat message
 * @param documentIds The IDs of the documents belonging to this session
 * @param accessToken The user's auth token to enforce Row Level Security
 * @param matchCount The number of top chunks to return
 * @returns A formatted markdown string of context
 */
export async function retrieveContext(
    query: string,
    documentIds: string[],
    accessToken?: string,
    matchCount = 5
): Promise<string> {
    if (documentIds.length === 0) return '';

    // 1. Vectorize the user's query
    const embedding = await embedder.embedQuery(query);

    // 2. Query the database securely using the RPC function
    const supabase = getSupabaseClient(accessToken);

    const { data: chunks, error } = await supabase.rpc('match_document_chunks', {
        // pgvector functions often prefer raw arrays or stringified JSON arrays
        query_embedding: JSON.stringify(embedding),
        match_count: matchCount,
        filter_document_ids: documentIds
    });

    if (error) {
        console.error('RAG Retrieval Error:', error);
        throw new Error(`Failed to retrieve document chunks: ${error.message}`);
    }

    // 3. Format the returned chunks into a readable string for the LLM
    // Filter by similarity threshold to avoid irrelevant 'noise'.
    // gemini-embedding-001 cosine similarities for related query/chunk pairs
    // typically land between 0.5 and 0.75, while unrelated pairs stay well
    // under 0.4 — so 0.5 filters noise without discarding relevant context.
    const THRESHOLD = 0.5;
    const relevantChunks = chunks.filter((chunk: any) => chunk.similarity >= THRESHOLD);

    if (relevantChunks.length === 0) {
        return '';
    }

    const formattedContext = relevantChunks.map((chunk: any) => {
        return `[Source Context (Similarity: ${(chunk.similarity * 100).toFixed(1)}%)]:\n${chunk.content}`;
    }).join('\n\n---\n\n');

    return formattedContext;
}
