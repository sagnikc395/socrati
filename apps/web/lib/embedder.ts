import { createHash } from "node:crypto";
import { Chunk } from "./chunker";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmbeddedChunk extends Chunk {
    embedding: number[];
    /** sha256 of content — set by embedChunksWithReuse for cache lookups. */
    contentHash?: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
// Using Google gemini-embedding-001, requested at 1536 dimensions.
//
// 1536 is deliberate, not arbitrary: pgvector's ivfflat and hnsw indexes
// support at most 2000 dimensions, so the model's native 3072 cannot be
// indexed. `document_chunks.embedding` is vector(1536) to match — see
// supabase/migrations/0010_document_chunks_embedding_1536.sql.
//
// Set GEMINI_API_KEY in your .env file.
// Set EMBEDDING_MOCK=true in .env to skip API calls during local dev/testing.

const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIM = 1536;
const GEMINI_EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:batchEmbedContents`;

// Gemini batchEmbedContents supports up to 100 inputs per request.
const BATCH_SIZE = 100;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------
// gemini-embedding-001 only returns unit-length vectors at its native 3072
// dimensions. Any smaller outputDimensionality is a truncation of that vector
// and must be re-normalized by the caller, otherwise cosine distance in
// pgvector is computed against vectors of differing magnitude and similarity
// scores drift below the retrieval threshold.

function normalize(vector: number[]): number[] {
    let sumOfSquares = 0;
    for (const value of vector) sumOfSquares += value * value;

    const magnitude = Math.sqrt(sumOfSquares);
    if (magnitude === 0) return vector;

    return vector.map((value) => value / magnitude);
}

// ---------------------------------------------------------------------------
// Mock embedding (dev / test)
// ---------------------------------------------------------------------------

function mockEmbedding(text: string): number[] {
    let seed = 0;
    for (let i = 0; i < text.length; i++) seed = (seed * 31 + text.charCodeAt(i)) >>> 0;

    // Normalized like the real vectors, so cosine distance behaves the same
    // way in tests as it does in production.
    return normalize(
        Array.from({ length: EMBEDDING_DIM }, (_, i) => {
            const x = Math.sin(seed + i) * 10000;
            return x - Math.floor(x);
        }),
    );
}

// ---------------------------------------------------------------------------
// Real embedding via Gemini batchEmbedContents API
// ---------------------------------------------------------------------------

async function fetchEmbeddings(texts: string[]): Promise<number[][]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set in environment.");

    const requests = texts.map((text) => ({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIM,
    }));

    const response = await fetch(`${GEMINI_EMBED_URL}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Gemini embeddings API error ${response.status}: ${error}`);
    }

    const data = await response.json();

    // Response shape: { embeddings: [{ values: number[] }, ...] }
    const embeddings = data.embeddings as { values: number[] }[] | undefined;
    if (!embeddings || embeddings.length !== texts.length) {
        throw new Error(
            `Gemini embeddings API returned ${embeddings?.length ?? 0} embeddings for ${texts.length} inputs.`,
        );
    }

    return embeddings.map((e) => normalize(e.values));
}

// ---------------------------------------------------------------------------
// Batch helper
// ---------------------------------------------------------------------------

function batchArray<T>(arr: T[], size: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        batches.push(arr.slice(i, i + size));
    }
    return batches;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function embedChunks(chunks: Chunk[]): Promise<EmbeddedChunk[]> {
    if (chunks.length === 0) return [];

    const useMock = process.env.EMBEDDING_MOCK === "true";

    if (useMock) {
        console.warn("[embedder] EMBEDDING_MOCK=true — using fake vectors.");
        return chunks.map((chunk) => ({
            ...chunk,
            embedding: mockEmbedding(chunk.content),
        }));
    }

    const batches = batchArray(chunks, BATCH_SIZE);
    const allEmbeddings: number[][] = [];

    for (const batch of batches) {
        const texts = batch.map((c) => c.content);
        const embeddings = await fetchEmbeddings(texts);
        allEmbeddings.push(...embeddings);
    }

    const embedded = chunks.map((chunk, i) => ({
        ...chunk,
        embedding: allEmbeddings[i]!,
    }));

    // Validate dimensions before anything touches the DB
    for (const chunk of embedded) {
        if (chunk.embedding.length !== EMBEDDING_DIM) {
            throw new Error(
                `Embedding dimension mismatch: expected ${EMBEDDING_DIM}, got ${chunk.embedding.length} on chunk ${chunk.chunkIndex}`
            );
        }
    }

    return embedded;
}

// ---------------------------------------------------------------------------
// Embedding reuse — Phase 2: re-uploads skip re-embedding
// ---------------------------------------------------------------------------

export function contentHash(text: string): string {
    return createHash("sha256").update(text).digest("hex");
}

/**
 * Embeds only chunks whose sha256 content hash is not already stored for the
 * document; matched chunks reuse the cached vector. Returns every chunk with
 * an embedding plus the count reused (for the ingestion log).
 */
export async function embedChunksWithReuse(
    chunks: Chunk[],
    cachedEmbeddings: Map<string, number[]>,
): Promise<{ embedded: EmbeddedChunk[]; reused: number }> {
    if (chunks.length === 0) return { embedded: [], reused: 0 };

    const hashes = chunks.map((c) => contentHash(c.content));
    const toEmbed: { index: number; chunk: Chunk }[] = [];

    const embedded: EmbeddedChunk[] = chunks.map((chunk, i) => {
        const cached = cachedEmbeddings.get(hashes[i]!);
        if (cached) return { ...chunk, embedding: cached, contentHash: hashes[i] };
        toEmbed.push({ index: i, chunk });
        return { ...chunk, embedding: [] }; // placeholder, replaced below
    });

    if (toEmbed.length > 0) {
        const fresh = await embedChunks(toEmbed.map((t) => t.chunk));
        fresh.forEach((result, i) => {
            embedded[toEmbed[i]!.index] = { ...result, contentHash: hashes[toEmbed[i]!.index] };
        });
    }

    return { embedded, reused: chunks.length - toEmbed.length };
}

// ---------------------------------------------------------------------------
// Single query embedder (for RAG chat pipeline)
// ---------------------------------------------------------------------------

export async function embedQuery(query: string): Promise<number[]> {
    const useMock = process.env.EMBEDDING_MOCK === "true";

    if (useMock) {
        console.warn("[embedder] EMBEDDING_MOCK=true — using fake vectors for query.");
        return mockEmbedding(query);
    }

    const embeddings = await fetchEmbeddings([query]);
    
    if (!embeddings[0] || embeddings[0].length !== EMBEDDING_DIM) {
        throw new Error(`Query embedding failed or dimension mismatch: expected ${EMBEDDING_DIM}, got ${embeddings[0]?.length}`);
    }
    
    return embeddings[0];
}