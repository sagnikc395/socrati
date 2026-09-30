import { retrieveContext } from '@/lib/rag';
import { buildSystemPrompt } from '@/lib/prompts';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { streamText } from 'ai';
import { createGroq } from '@ai-sdk/groq';
import { loadEnvFiles } from '@/lib/load-env';
import { performWebSearch } from '@/lib/web-agent';

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
    const cookieStore = await cookies();
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { cookies: { getAll: () => cookieStore.getAll() } }
    );
    const { data: { session } } = await supabase.auth.getSession();
    const accessToken = session?.access_token;

    // Retrieve RAG context for the latest user message
    const lastUserMessage = [...rawMessages].reverse().find((m) => m?.role === 'user');
    const lastUserText = lastUserMessage ? extractText(lastUserMessage) : '';

    const context = lastUserText
        ? await retrieveContext(lastUserText, validDocumentIds, accessToken)
        : '';

    // If RAG returned nothing, call Tavily directly — no LLM tool calling needed
    let webSearchResults = '';
    let webSearchUsed = false;
    if (!context.trim() && lastUserText) {
        webSearchResults = await performWebSearch(lastUserText);
        webSearchUsed = true;
    }

    const userId = session?.user?.id;

    // Save user message to database
    if (userId && sessionId && lastUserText) {
        const { error } = await supabase.from('messages').insert({
            session_id: sessionId,
            user_id: userId,
            role: 'user',
            content: lastUserText,
        });
        if (error) {
            console.error('[chat] failed to save user message:', error.message);
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

    // Stream Socratic response from Groq (Llama 3.3 70B)
    const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

    const result = streamText({
        // Use the larger model if web results are involved to ensure the hidden tag is included
        model: webSearchUsed ? groq('llama-3.3-70b-versatile') : groq('llama-3.1-8b-instant'),
        system: buildSystemPrompt(context, webSearchResults || undefined),
        messages: modelMessages,
        onFinish: async ({ text }) => {
            if (userId && sessionId && text) {
                const { error } = await supabase.from('messages').insert({
                    session_id: sessionId,
                    user_id: userId,
                    role: 'assistant',
                    content: text,
                });
                if (error) {
                    console.error('[chat] failed to save assistant message:', error.message);
                }
            }
        },
    });

    return result.toUIMessageStreamResponse();
}
