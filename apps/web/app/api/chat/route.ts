import { retrieveContext } from '@/lib/rag';
import { buildSystemPrompt } from '@/lib/prompts';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { streamText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { loadEnvFiles } from '@/lib/load-env';
import { performWebSearch } from '@/lib/web-agent';
import { logDocument } from '@/lib/logger';
import { checkRateLimit } from '@/lib/redis';
import { recordLlmUsage } from '@/lib/repository';

export const runtime = 'nodejs';

type ChatRequestBody = {
    messages?: unknown;
    documentIds?: unknown;
    sessionId?: unknown;
};

type IncomingMessage = {
    role?: unknown;
    content?: unknown;
    parts?: unknown;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Bigger model when web results are in play so the hidden tag survives
const CHAT_MODEL = 'llama-3.1-8b-instant';
const CHAT_MODEL_WEB = 'llama-3.3-70b-versatile';

function extractText(m: IncomingMessage): string {
    // user messages carry a string content; assistant messages may use
    // parts[] (streamed) or a plain content string (hydrated from the DB)
    if (m.role === 'user') return typeof m.content === 'string' ? m.content : '';
    const fromParts = Array.isArray(m.parts)
        ? (m.parts as { type?: unknown; text?: unknown }[])
            .filter((p) => p?.type === 'text' && typeof p.text === 'string')
            .map((p) => p.text)
            .join('')
        : '';
    return fromParts || (typeof m.content === 'string' ? m.content : '');
}

export async function POST(req: Request) {
    loadEnvFiles();

    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
    const startedAt = Date.now();
    const log = logDocument.bind({ requestId });

    let body: ChatRequestBody;
    try {
        body = (await req.json()) as ChatRequestBody;
    } catch {
        return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { documentIds, sessionId } = body;
    const rawMessages = Array.isArray(body.messages)
        ? (body.messages as IncomingMessage[])
        : undefined;

    if (!rawMessages || rawMessages.length === 0) {
        return Response.json({ error: 'messages array is required' }, { status: 400 });
    }

    if (
        documentIds !== undefined &&
        (!Array.isArray(documentIds) ||
            !documentIds.every((id) => typeof id === 'string' && UUID_RE.test(id)))
    ) {
        return Response.json({ error: 'documentIds must be valid UUIDs' }, { status: 400 });
    }

    const validDocumentIds = Array.isArray(documentIds)
        ? (documentIds as string[]).filter((id) => UUID_RE.test(id))
        : [];

    if (sessionId !== undefined && sessionId !== null && typeof sessionId !== 'string') {
        return Response.json({ error: 'sessionId must be a string' }, { status: 400 });
    }

    // Extract user JWT from cookies so RLS is enforced in retrieveContext
    const authStart = Date.now();
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll: () => cookieStore.getAll() } }
    );
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;
    const userId = session?.user?.id;
    const authMs = Date.now() - authStart;

    // Per-user rate limit (30 req/min) — fails open if Redis is down
    if (userId) {
        const rl = await checkRateLimit(userId);
        if (!rl.allowed) {
            log.event('chat', 'rate limited', { userId, retryAfterSec: rl.retryAfterSec });
            return Response.json(
                { error: 'Too many requests. Please slow down.' },
                { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
            );
        }
    }

    // Retrieve RAG context for the latest user message
    const lastUserMessage = [...rawMessages].reverse().find((m) => m?.role === 'user');
    const lastUserText = lastUserMessage ? extractText(lastUserMessage) : '';

    const retrievalStart = Date.now();
    const context = lastUserText
        ? await retrieveContext(lastUserText, validDocumentIds, accessToken)
        : '';
    const retrievalMs = Date.now() - retrievalStart;

    // If RAG returned nothing, call Tavily directly — no LLM tool calling needed
    let webSearchResults = '';
    let webSearchUsed = false;
    if (!context.trim() && lastUserText) {
        webSearchResults = await performWebSearch(lastUserText);
        webSearchUsed = true;
    }

    // Save user message to database
    if (userId && sessionId && lastUserText) {
        const { error } = await supabase.from('messages').insert({
            session_id: sessionId,
            user_id: userId,
            role: 'user',
            content: lastUserText,
        });
        if (error) {
            log.error('chat', 'failed to save user message', error);
        }
    }

    // Convert UIMessage[] → CoreMessage[] for Groq
    const modelMessages = rawMessages
        .filter((m) => m?.role === 'user' || m?.role === 'assistant')
        .map((m) => ({
            role: m.role as 'user' | 'assistant',
            content: extractText(m),
        }))
        .filter((m) => m.content.trim().length > 0);

    if (!process.env.GROQ_API_KEY) {
        return Response.json({ error: 'Chat is not configured (missing GROQ_API_KEY).' }, { status: 500 });
    }

    const model = webSearchUsed ? CHAT_MODEL_WEB : CHAT_MODEL;

    // Stream Socratic response from Groq
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

    const result = streamText({
        model: groq(model),
        system: buildSystemPrompt(context, webSearchResults || undefined),
        messages: modelMessages,
        onFinish: async ({ text, usage }) => {
            if (userId && sessionId && text) {
                const { error } = await supabase.from('messages').insert({
                    session_id: sessionId,
                    user_id: userId,
                    role: 'assistant',
                    content: text,
                });
                if (error) {
                    log.error('chat', 'failed to save assistant message', error);
                }
            }

            const totalMs = Date.now() - startedAt;

            // One usage row per chat turn (Phase 2 observability)
            void recordLlmUsage({
                userId: userId ?? null,
                sessionId: typeof sessionId === 'string' ? sessionId : null,
                feature: 'chat',
                provider: 'groq',
                model,
                inputTokens: usage?.promptTokens,
                outputTokens: usage?.completionTokens,
                ttftMs: undefined,
                totalMs,
            });

            // One structured line per chat turn with the Phase-2 timing fields
            log.event('chat', 'turn complete', {
                userId,
                sessionId,
                web_fallback: webSearchUsed,
                llm_model: model,
                input_tokens: usage?.promptTokens,
                output_tokens: usage?.completionTokens,
                auth_ms: authMs,
                retrieval_ms: retrievalMs,
                total_ms: totalMs,
            });
        },
    });

    return result.toUIMessageStreamResponse();
}
