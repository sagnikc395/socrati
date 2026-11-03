# Mind Map Backend Implementation Log

## Summary

Implemented the backend for generating document mind maps from uploaded document chunks.

Students can now call `POST /api/mindmap/generate` with a `documentId`. The backend samples document chunks, prompts Groq Llama 3 8B to extract a topic hierarchy, validates the response with Zod, and returns a React Flow-compatible graph:

```json
{
  "nodes": [
    {
      "id": "root",
      "label": "Document Theme",
      "description": "Short AI-generated description.",
      "level": 0
    }
  ],
  "edges": [
    {
      "source": "root",
      "target": "topic"
    }
  ]
}
```

If the document is too short or does not contain enough clear structure, the endpoint returns a flat key-term graph with `nodes`, empty `edges`, and a `warning`.

## Files Changed

### Added

- `apps/web/app/api/mindmap/generate/route.ts`
  - Added the authenticated Next.js API route for `POST /api/mindmap/generate`.
  - Reads `documentId` from the request body.
  - Validates the request body.
  - Uses the current Supabase session access token.
  - Delegates generation to `generateMindMap`.
  - Returns JSON graph output or an error response.

- `apps/web/lib/mindmap.ts`
  - Added the main mind map generation service.
  - Fetches document chunks from `document_chunks`.
  - Samples representative chunks instead of sending the full document to the LLM.
  - Builds a bounded prompt for Groq Llama 3 8B.
  - Prompts Groq to return only valid JSON in this shape:
    - `nodes: [{ id, label, description, level }]`
    - `edges: [{ source, target }]`
  - Validates the Groq response with Zod.
  - Sanitizes node IDs and filters invalid edges.
  - Detects whether the graph is truly hierarchical.
  - Returns fallback flat key-term graphs for short or unstructured documents.
  - Logs generation lifecycle events.

- `apps/web/lib/mindmap-logger.ts`
  - Added logging helpers for mind map backend events and errors.
  - Redacts sensitive fields such as tokens, keys, secrets, and passwords.
  - Uses log prefixes like `[mindmap:generate]` and `[mindmap:route]`.

- `tests/mindmap.test.ts`
  - Added tests for the mind map generation service.
  - Covers:
    - Successful hierarchical graph generation.
    - React Flow-compatible `nodes` and `edges`.
    - Groq Llama 3 8B request shape.
    - Representative chunk sampling.
    - Short-document fallback with warning.
    - Unstructured-document fallback with warning.
    - Invalid Groq JSON handling.
    - Groq API error handling.

- `MIND_MAP_BACKEND.md`
  - Added this implementation log.

### Modified

- `tests/rag.test.ts`
  - Added the `ws` WebSocket shim used by other tests.
  - This fixes Supabase client initialization under Node 20 during tests.

- `turbo.json`
  - Added `GROQ_API_KEY` to `globalEnv`.
  - This removes the Turbo lint warning for Groq usage in the new mind map backend and existing Groq-backed code paths.

## Endpoint Behavior

### Request

```http
POST /api/mindmap/generate
Content-Type: application/json
```

```json
{
  "documentId": "document-id"
}
```

### Successful Hierarchical Response

```json
{
  "nodes": [
    {
      "id": "document-theme",
      "label": "Document Theme",
      "description": "The central theme of the uploaded document.",
      "level": 0
    },
    {
      "id": "major-topic",
      "label": "Major Topic",
      "description": "A first-level branch extracted from the document.",
      "level": 1
    }
  ],
  "edges": [
    {
      "source": "document-theme",
      "target": "major-topic"
    }
  ]
}
```

### Short or Unstructured Response

```json
{
  "warning": "Document is too short to build a reliable hierarchy. Returning key terms instead.",
  "nodes": [
    {
      "id": "mitosis",
      "label": "Mitosis",
      "description": "Key term identified from the uploaded document: mitosis.",
      "level": 1
    }
  ],
  "edges": []
}
```

## LLM Implementation Details

- Provider: Groq
- Model: `llama-3.1-8b-instant`
- API endpoint: `https://api.groq.com/openai/v1/chat/completions`
- Response format requested: JSON object
- Temperature: `0.2`
- Max tokens: `3500`

The prompt asks the model to produce:

- One root node at `level: 0`.
- First-level major topics at `level: 1`.
- Second-level subtopics or key terms at `level: 2`.
- Short 1-2 sentence descriptions for every node.
- Valid JSON only, with no markdown or extra text.

## Chunk Sampling

The backend does not send all chunks to the LLM.

Implemented limits:

- Fetches up to `60` chunks from Supabase.
- Samples up to `12` representative chunks.
- Caps prompt context at `12000` characters.
- Includes chunk heading and existing key terms when available.

This keeps the prompt within the model context window while preserving coverage from the beginning, middle, and end of the document.

## Validation and Fallbacks

The Groq response is validated with Zod using:

- `MindMapNodeSchema`
- `MindMapEdgeSchema`
- `MindMapGraphSchema`

Each node must include:

- `id`
- `label`
- `description`
- `level`

Each edge must include:

- `source`
- `target`

Fallback behavior:

- If no chunks exist, generation throws `No content found for this document.`
- If the document has fewer than `80` words, a flat key-term graph is returned with a warning.
- If the LLM response is valid JSON but not hierarchical, a flat key-term graph is returned with a warning.
- If Groq returns invalid JSON, generation throws an invalid JSON error.
- If Groq returns a non-OK status, generation throws a Groq API error.

## Logging

Added structured logs for:

- Request authorization failures.
- Invalid request bodies.
- Missing `documentId`.
- Chunk fetch start and failure.
- Short-document fallback.
- Groq topic extraction calls.
- Unstructured-document fallback.
- Successful generation.
- Route-level generation failures.

Sensitive fields are redacted in logs.

## Tests Added

`tests/mindmap.test.ts` verifies:

- Successful graph response.
- Node descriptions are present.
- Response is compatible with React Flow-style `nodes` and `edges`.
- Groq is called with `llama-3.1-8b-instant`.
- Prompt asks for valid JSON only.
- Chunk sampling omits some chunks for larger documents.
- Short documents return a flat graph and warning.
- Unstructured documents return a flat graph and warning.
- Invalid Groq JSON throws an error.
- Groq API failures throw an error.

## Verification Performed

Commands run:

```bash
node --import tsx --test tests/mindmap.test.ts
npm test
npm run check-types
npm run lint
```

Results:

- `node --import tsx --test tests/mindmap.test.ts` passed.
- `npm test` passed with `150/150` tests.
- `npm run check-types` passed.
- `npm run lint` still fails because the repo has existing warnings in unrelated files and lint is configured with `--max-warnings 0`.

The new `GROQ_API_KEY` Turbo warning introduced by this backend was resolved by updating `turbo.json`.

## Notes

- `package.json` already had an unrelated uncommitted `test:coverage` script change. It was not part of the mind map backend implementation.
- `npm install` was run because the local workspace was missing installed dependencies needed to run tests.
- Lockfile noise introduced by `npm install` was removed manually so the implementation changes stayed focused.
