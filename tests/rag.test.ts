import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as rag from '../apps/web/lib/rag';
import ws from 'ws';

(global as any).WebSocket = ws;

describe('RAG Pipeline', () => {
    afterEach(() => {
        mock.restoreAll();
    });

    it('returns empty string if no documentIds are provided', async () => {
        const result = await rag.retrieveContext('What is mitosis?', []);
        assert.equal(result, '');
    });

    it('retrieves and formats chunks correctly from the database', async () => {
        // Mock global.fetch to intercept both the Gemini API and Supabase RPC calls
        const mockFetch = mock.method(global, 'fetch', async (url: string | URL | Request, options: any) => {
            const urlString = url.toString();
            
            // Intercept Gemini Embedding API
            if (urlString.includes('generativelanguage.googleapis.com')) {
                return new Response(JSON.stringify({
                    embeddings: [{ values: Array(1536).fill(0.1) }]
                }), { status: 200 });
            }

            // Intercept Supabase RPC call
            if (urlString.includes('/rest/v1/rpc/match_document_chunks')) {
                return new Response(JSON.stringify([
                    { content: 'Mitosis is cellular division.', similarity: 0.95 },
                    { content: 'It results in two identical cells.', similarity: 0.88 }
                ]), { 
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            throw new Error(`Unexpected fetch call: ${urlString}`);
        });

        // Set fake environment variables for the test
        process.env.GEMINI_API_KEY = 'fake-gemini-key';
        process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fake-supabase-url.supabase.co';
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fake-anon-key';

        const result = await rag.retrieveContext('What is mitosis?', ['doc-1'], 'fake-token');

        assert.equal(mockFetch.mock.callCount(), 2);
        
        // Check formatting
        const expected = `[Source Context (Similarity: 95.0%)]:\nMitosis is cellular division.\n\n---\n\n[Source Context (Similarity: 88.0%)]:\nIt results in two identical cells.`;
        assert.equal(result, expected);
    });

    it('returns empty string if no chunks match', async () => {
        mock.method(global, 'fetch', async (url: string | URL | Request) => {
            const urlString = url.toString();
            if (urlString.includes('generativelanguage.googleapis.com')) {
                return new Response(JSON.stringify({ embeddings: [{ values: Array(1536).fill(0.1) }] }), { status: 200 });
            }
            if (urlString.includes('/rest/v1/rpc/match_document_chunks')) {
                return new Response(JSON.stringify([]), { status: 200 });
            }
            throw new Error(`Unexpected fetch call: ${urlString}`);
        });

        const result = await rag.retrieveContext('What is irrelevant?', ['doc-1'], 'fake-token');
        assert.equal(result, '');
    });
});
