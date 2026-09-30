// Shared Groq chat-completions helper for JSON-mode generation (quiz, mindmap).

export async function callGroqJson(opts: {
    prompt: string;
    temperature?: number;
    maxTokens?: number;
}): Promise<unknown> {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
            model: 'llama-3.1-8b-instant',
            messages: [{ role: 'user', content: opts.prompt }],
            temperature: opts.temperature ?? 0.2,
            max_tokens: opts.maxTokens ?? 3500,
            response_format: { type: 'json_object' },
        }),
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Groq API error: ${err}`);
    }

    const data = await res.json();
    const rawText = data.choices?.[0]?.message?.content ?? '';

    // Models sometimes wrap JSON in markdown fences despite json_object mode
    const clean = rawText.replace(/```json|```/g, '').trim();

    let parsed: unknown;
    try {
        parsed = JSON.parse(clean);
    } catch {
        throw new Error(`Generation returned invalid JSON. Raw: ${rawText.slice(0, 300)}`);
    }

    return parsed;
}
