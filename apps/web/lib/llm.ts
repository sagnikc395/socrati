import { createGroq } from '@ai-sdk/groq';
import { streamText, type StreamTextResult, type ToolSet } from 'ai';
import { log } from './logger';
import { recordLlmUsage } from './repository';

// ── Config ────────────────────────────────────────────────────────────────────

const PRIMARY_MODEL = 'llama-3.1-8b-instant';
const FALLBACK_MODEL = 'llama-3.3-70b-versatile';
const CALL_TIMEOUT_MS = 8_000;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const CIRCUIT_THRESHOLD = 3; // consecutive total failures before opening
const CIRCUIT_OPEN_MS = 30_000; // half-open after this long

// ── Types ─────────────────────────────────────────────────────────────────────

export type LlmFeature = 'chat' | 'quiz' | 'mindmap' | 'voice';

export type ChatMessage = {
    role: 'system' | 'user' | 'assistant';
    content: string;
};

export type LlmCallMeta = {
    provider: 'groq' | 'fallback';
    model: string;
    ttftMs: number;
    totalMs: number;
    fallbackUsed: boolean;
    inputTokens?: number;
    outputTokens?: number;
};

export type LlmDeps = {
    fetchFn?: typeof fetch;
    now?: () => number;
    /** Wire in tests; defaults to the pooled Drizzle client. */
    recordUsage?: typeof recordLlmUsage;
};

type GroqUsage = { prompt_tokens?: number; completion_tokens?: number };

type GroqResponse = {
    choices?: { message?: { content?: string } }[];
    usage?: GroqUsage;
};

// ── Circuit breaker (module state; one per server process) ───────────────────

let consecutiveFailures = 0;
let openUntil = 0;

export function isCircuitOpen(now = Date.now()): boolean {
    return now < openUntil;
}

/** Test hook: reset breaker state between tests. */
export function resetCircuitBreaker() {
    consecutiveFailures = 0;
    openUntil = 0;
}

function noteSuccess() {
    consecutiveFailures = 0;
}

function noteFailure(feature: LlmFeature, now: () => number = Date.now) {
    consecutiveFailures += 1;
    if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
        openUntil = now() + CIRCUIT_OPEN_MS;
        consecutiveFailures = 0;
        log.event('llm', 'circuit breaker opened', { openUntil, feature });
    }
}

// ── Core call ────────────────────────────────────────────────────────────────

async function postGroq(
    model: string,
    body: Record<string, unknown>,
    opts: { temperature: number; maxTokens: number; signal: AbortSignal },
    fetchFn: typeof fetch,
): Promise<{ text: string; ttftMs: number; totalMs: number; usage?: GroqUsage }> {
    const startedAt = Date.now();

    const res = await fetchFn(GROQ_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
            model,
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
            ...body,
        }),
        signal: opts.signal,
    });

    if (!res.ok) {
        throw new Error(`Groq API error (${model}): ${await res.text()}`);
    }

    const data = (await res.json()) as GroqResponse;
    const text = data.choices?.[0]?.message?.content ?? '';

    // Non-streaming: first token arrives with the full body, so TTFT ≈ total
    return { text, ttftMs: Date.now() - startedAt, totalMs: Date.now() - startedAt, usage: data.usage };
}

function parseJsonBody(text: string): unknown {
    // Models sometimes wrap JSON in markdown fences despite json_object mode
    const clean = text.replace(/```json|```/g, '').trim();
    try {
        return JSON.parse(clean);
    } catch {
        throw new Error(`Generation returned invalid JSON. Raw: ${text.slice(0, 300)}`);
    }
}

type CallOptions = {
    temperature?: number;
    maxTokens?: number;
    userId?: string;
    sessionId?: string;
};

/**
 * Shared fallback loop: primary model first, then the larger fallback, each
 * bounded by an 8s timeout. A shared circuit breaker skips the primary
 * entirely while it's failing. Writes one llm_usage row.
 */
async function callWithFallback<T>(
    feature: LlmFeature,
    buildBody: (model: string) => Record<string, unknown>,
    parse: (text: string) => T,
    callOpts: CallOptions,
    deps: LlmDeps,
): Promise<{ value: T; meta: LlmCallMeta }> {
    const fetchFn = deps.fetchFn ?? fetch;
    const now = deps.now ?? Date.now;
    const record = deps.recordUsage ?? recordLlmUsage;

    const meta: LlmCallMeta = {
        provider: 'groq',
        model: PRIMARY_MODEL,
        ttftMs: 0,
        totalMs: 0,
        fallbackUsed: false,
    };

    const startedAt = now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

    const attempts = isCircuitOpen(now())
        ? [{ provider: 'fallback' as const, name: FALLBACK_MODEL }]
        : [
              { provider: 'groq' as const, name: PRIMARY_MODEL },
              { provider: 'fallback' as const, name: FALLBACK_MODEL },
          ];

    let lastError: unknown;

    try {
        for (const attempt of attempts) {
            try {
                const r = await postGroq(
                    attempt.name,
                    buildBody(attempt.name),
                    {
                        temperature: callOpts.temperature ?? 0.2,
                        maxTokens: callOpts.maxTokens ?? 3500,
                        signal: controller.signal,
                    },
                    fetchFn,
                );
                const value = parse(r.text);

                meta.provider = attempt.provider;
                meta.model = attempt.name;
                meta.ttftMs = r.ttftMs;
                meta.totalMs = now() - startedAt;
                meta.fallbackUsed = attempt.provider === 'fallback';
                meta.inputTokens = r.usage?.prompt_tokens;
                meta.outputTokens = r.usage?.completion_tokens;
                noteSuccess();

                return { value, meta };
            } catch (err) {
                lastError = err;
                log.error('llm', 'model attempt failed', err, { model: attempt.name, feature });
            }
        }

        // Every attempt failed — count toward opening the breaker
        noteFailure(feature, now);
        throw lastError;
    } finally {
        clearTimeout(timeout);
        void record({
            userId: callOpts.userId ?? null,
            sessionId: callOpts.sessionId ?? null,
            feature,
            provider: meta.provider,
            model: meta.model,
            inputTokens: meta.inputTokens ?? null,
            outputTokens: meta.outputTokens ?? null,
            ttftMs: meta.ttftMs,
            totalMs: meta.totalMs,
            fallbackUsed: meta.fallbackUsed,
        });
    }
}

// ── Public API ───────────────────────────────────────────────────────────────

/** One JSON-mode LLM call (quiz / mindmap / structured features). */
export async function callLlmJson(
    feature: LlmFeature,
    prompt: string,
    callOpts: CallOptions = {},
    deps: LlmDeps = {},
): Promise<{ parsed: unknown; meta: LlmCallMeta }> {
    const { value, meta } = await callWithFallback(
        feature,
        () => ({
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
        }),
        parseJsonBody,
        callOpts,
        deps,
    );
    return { parsed: value, meta };
}

/**
 * One plain-text chat completion (Socratic reply for voice turns). Same
 * fallback + circuit breaker + usage recording as callLlmJson.
 */
export async function callLlmChat(
    feature: LlmFeature,
    messages: ChatMessage[],
    callOpts: CallOptions = {},
    deps: LlmDeps = {},
): Promise<{ text: string; meta: LlmCallMeta }> {
    const { value, meta } = await callWithFallback(
        feature,
        () => ({ messages }),
        (text) => text.trim(),
        callOpts,
        deps,
    );
    return { text: value, meta };
}

/**
 * Streaming chat completion (the Socratic reply the browser consumes).
 *
 * Shares this module's model choice, circuit breaker and llm_usage recording
 * with callLlmJson/callLlmChat, so Groq policy lives in one place. It does
 * *not* share callWithFallback's retry: once a token has been emitted the
 * response is committed, so a mid-stream swap would duplicate output. The
 * breaker therefore only chooses the model up front — a failed stream counts
 * toward opening it, and the next caller starts on the fallback.
 */
export function streamLlmChat(
    feature: LlmFeature,
    opts: {
        system: string;
        messages: ChatMessage[];
        /** Larger model — used for turns carrying web-search results. */
        preferLarge?: boolean;
        userId?: string | null;
        sessionId?: string | null;
        /** Called with the finished reply (persistence, logging). */
        onFinish?: (args: {
            text: string;
            model: string;
            totalMs: number;
            inputTokens?: number;
            outputTokens?: number;
        }) => Promise<void> | void;
    },
): { model: string; result: StreamTextResult<ToolSet, never> } {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY is missing — required for chat.');

    const startedAt = Date.now();
    const model = opts.preferLarge || isCircuitOpen() ? FALLBACK_MODEL : PRIMARY_MODEL;
    const groq = createGroq({ apiKey });

    const result = streamText({
        model: groq(model),
        system: opts.system,
        messages: opts.messages,
        onError: ({ error }) => {
            log.error('llm', 'stream failed', error, { model, feature });
            noteFailure(feature);
        },
        onFinish: async ({ text, usage }) => {
            noteSuccess();
            const totalMs = Date.now() - startedAt;

            void recordLlmUsage({
                userId: opts.userId ?? null,
                sessionId: opts.sessionId ?? null,
                feature,
                provider: model === FALLBACK_MODEL ? 'fallback' : 'groq',
                model,
                inputTokens: usage?.inputTokens ?? null,
                outputTokens: usage?.outputTokens ?? null,
                totalMs,
                fallbackUsed: model === FALLBACK_MODEL,
            });

            await opts.onFinish?.({
                text,
                model,
                totalMs,
                inputTokens: usage?.inputTokens,
                outputTokens: usage?.outputTokens,
            });
        },
    });

    return { model, result };
}
