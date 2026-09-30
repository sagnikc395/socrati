import { logMindMap } from './logger';
import { recordLlmUsage } from './repository';

// ── Config ────────────────────────────────────────────────────────────────────

const PRIMARY_MODEL = 'llama-3.1-8b-instant';
const FALLBACK_MODEL = 'llama-3.3-70b-versatile';
const CALL_TIMEOUT_MS = 8_000;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const CIRCUIT_THRESHOLD = 3; // consecutive total failures before opening
const CIRCUIT_OPEN_MS = 30_000; // half-open after this long

// ── Types ─────────────────────────────────────────────────────────────────────

export type LlmFeature = 'chat' | 'quiz' | 'mindmap';

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

type GroqResponse = {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
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

// ── Core call ────────────────────────────────────────────────────────────────

async function callGroqModel(
    model: string,
    prompt: string,
    opts: { temperature: number; maxTokens: number; signal: AbortSignal },
    fetchFn: typeof fetch,
): Promise<{ text: string; ttftMs: number; totalMs: number; usage?: GroqResponse['usage'] }> {
    const startedAt = Date.now();

    const res = await fetchFn(GROQ_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: opts.temperature,
            max_tokens: opts.maxTokens,
            response_format: { type: 'json_object' },
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

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * One JSON-mode LLM call with provider fallback: primary model first, then the
 * larger fallback, each bounded by an 8s timeout. A shared circuit breaker
 * skips the primary entirely while it's failing. Writes one llm_usage row.
 */
export async function callLlmJson(
    feature: LlmFeature,
    prompt: string,
    callOpts: { temperature?: number; maxTokens?: number; userId?: string; sessionId?: string } = {},
    deps: LlmDeps = {},
): Promise<{ parsed: unknown; meta: LlmCallMeta }> {
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
                const r = await callGroqModel(
                    attempt.name,
                    prompt,
                    {
                        temperature: callOpts.temperature ?? 0.2,
                        maxTokens: callOpts.maxTokens ?? 3500,
                        signal: controller.signal,
                    },
                    fetchFn,
                );
                const parsed = parseJsonBody(r.text);

                meta.provider = attempt.provider;
                meta.model = attempt.name;
                meta.ttftMs = r.ttftMs;
                meta.totalMs = now() - startedAt;
                meta.fallbackUsed = attempt.provider === 'fallback';
                meta.inputTokens = r.usage?.prompt_tokens;
                meta.outputTokens = r.usage?.completion_tokens;
                consecutiveFailures = 0;

                return { parsed, meta };
            } catch (err) {
                lastError = err;
                logMindMap.error('llm', 'model attempt failed', err, { model: attempt.name, feature });
            }
        }

        // Every attempt failed — count toward opening the breaker
        consecutiveFailures += 1;
        if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
            openUntil = now() + CIRCUIT_OPEN_MS;
            consecutiveFailures = 0;
            logMindMap.event('llm', 'circuit breaker opened', { openUntil, feature });
        }
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
