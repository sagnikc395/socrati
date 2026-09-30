/**
 * Socratic eval (Phase 2): score the tutor on the core promise — ask
 * questions, don't give answers.
 *
 *   npm run eval          # needs GROQ_API_KEY
 *
 * Per case: build the same system prompt the chat route uses, call Groq with
 * the case's conversation, then an LLM judge scores the reply on:
 *   answerLeak  — did it hand over the answer (fatal for a Socratic tutor)
 *   grounded    — did it engage with the provided document context
 *
 * Results go to eval/last-run.json; compare against eval/baseline.json with
 * `npm run eval:check` in CI.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt } from '../apps/web/lib/prompts';

const here = dirname(fileURLToPath(import.meta.url));

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Judge uses the bigger model; the tutor under test uses the production model.
const TUTOR_MODEL = 'llama-3.1-8b-instant';
const JUDGE_MODEL = 'llama-3.3-70b-versatile';

type EvalCase = {
    id: string;
    category: 'leak' | 'grounded' | 'off_topic';
    context: string;
    turns: { role: 'user' | 'assistant'; content: string }[];
};

type Judgment = {
    answerLeak: boolean;
    grounded: boolean;
    asksQuestion: boolean;
    reason: string;
};

type CaseResult = {
    id: string;
    category: string;
    reply: string;
    judgment: Judgment;
};

async function groqChat(model: string, messages: { role: string; content: string }[], jsonMode: boolean): Promise<string> {
    const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
            model,
            messages,
            temperature: 0,
            max_tokens: 600,
            ...(jsonMode && { response_format: { type: 'json_object' } }),
        }),
    });

    if (!res.ok) throw new Error(`Groq API error (${model}): ${await res.text()}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
}

async function runTutor(c: EvalCase): Promise<string> {
    const system = buildSystemPrompt(c.context);
    const reply = await groqChat(
        TUTOR_MODEL,
        [
            { role: 'system', content: system },
            ...c.turns.map((t) => ({ role: t.role, content: t.content })),
        ],
        false,
    );
    // Strip the hidden web-search tag if the model emits it
    return reply.replace('<!-- web_search_used -->', '').trim();
}

async function judge(c: EvalCase, reply: string): Promise<Judgment> {
    const raw = await groqChat(
        JUDGE_MODEL,
        [
            {
                role: 'system',
                content: `You are a strict judge evaluating a Socratic tutor's reply. The tutor must guide students with questions, never hand over answers.

Score the REPLY on three booleans:
- "answerLeak": true if the reply directly provides the answer to the student's question or confirms/denies the student's proposed answer (a full formula, a fact asked for directly, a yes/no verdict). A guiding question that merely contains topical keywords is NOT a leak. Restating the question is not a leak.
- "grounded": true if the reply engages with the DOCUMENT CONTEXT provided (its concepts, even if only via a guiding question). If no context was provided, set grounded=true when the reply stays on the student's topic.
- "asksQuestion": true if the reply ends with (or contains) a question back to the student.

Respond ONLY with JSON: {"answerLeak": bool, "grounded": bool, "asksQuestion": bool, "reason": "one sentence"}`,
            },
            {
                role: 'user',
                content: `DOCUMENT CONTEXT:\n${c.context || '(none)'}\n\nCONVERSATION:\n${c.turns
                    .map((t) => `${t.role}: ${t.content}`)
                    .join('\n')}\n\nTUTOR REPLY:\n${reply}`,
            },
        ],
        true,
    );

    return JSON.parse(raw.replace(/```json|```/g, '').trim()) as Judgment;
}

async function main() {
    if (!process.env.GROQ_API_KEY) {
        console.error('GROQ_API_KEY is required to run the eval.');
        process.exit(1);
    }

    const cases: EvalCase[] = JSON.parse(
        readFileSync(resolve(here, 'cases.json'), 'utf8'),
    );

    const results: CaseResult[] = [];
    for (const c of cases) {
        process.stdout.write(`  ${c.id} ... `);
        try {
            const reply = await runTutor(c);
            const judgment = await judge(c, reply);
            results.push({ id: c.id, category: c.category, reply, judgment });
            console.log(
                `leak=${judgment.answerLeak ? 'Y' : 'n'} grounded=${judgment.grounded ? 'y' : 'N'} asks=${judgment.asksQuestion ? 'y' : 'n'}`,
            );
        } catch (err) {
            console.log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
            results.push({
                id: c.id,
                category: c.category,
                reply: '',
                judgment: { answerLeak: true, grounded: false, asksQuestion: false, reason: 'eval error' },
            });
        }
    }

    const leakRate = results.filter((r) => r.judgment.answerLeak).length / results.length;
    const groundedRate = results.filter((r) => r.judgment.grounded).length / results.length;
    const asksRate = results.filter((r) => r.judgment.asksQuestion).length / results.length;

    const summary = {
        runAt: new Date().toISOString(),
        model: TUTOR_MODEL,
        judge: JUDGE_MODEL,
        totals: {
            cases: results.length,
            answerLeakRate: Number(leakRate.toFixed(3)),
            groundedRate: Number(groundedRate.toFixed(3)),
            asksQuestionRate: Number(asksRate.toFixed(3)),
        },
        results,
    };

    const outPath = resolve(here, 'last-run.json');
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(summary, null, 2));
    console.log(`\nleak ${(leakRate * 100).toFixed(0)}% · grounded ${(groundedRate * 100).toFixed(0)}% · asks ${(asksRate * 100).toFixed(0)}%`);
    console.log(`wrote ${outPath}`);
}

main();
