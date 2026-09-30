import { z } from 'zod';
import { logMindMap } from './logger';
import { callLlmJson } from './llm';
import { getAnonSupabaseClient } from './supabase/api';

const MAX_CHUNKS_TO_FETCH = 60;
const MAX_SAMPLE_CHUNKS = 12;
const MAX_CONTEXT_CHARS = 12000;
const MIN_WORDS_FOR_HIERARCHY = 80;
const FALLBACK_NODE_COUNT = 10;

const MindMapNodeSchema = z.object({
    id: z.string().min(1),
    label: z.string().min(1).max(80),
    description: z.string().min(1).max(400),
    level: z.number().int().min(0).max(2),
});

const MindMapEdgeSchema = z.object({
    source: z.string().min(1),
    target: z.string().min(1),
});

const MindMapGraphSchema = z.object({
    nodes: z.array(MindMapNodeSchema).min(1).max(40),
    edges: z.array(MindMapEdgeSchema).max(80),
});

export type MindMapNode = z.infer<typeof MindMapNodeSchema>;
export type MindMapEdge = z.infer<typeof MindMapEdgeSchema>;
export type MindMapGraph = z.infer<typeof MindMapGraphSchema>;

export type MindMapResult = MindMapGraph & {
    warning?: string;
};

type DocumentChunk = {
    content: string;
    chunk_index: number;
    heading?: string | null;
    key_terms?: string[] | null;
};

function normalizeId(value: string, fallback: string) {
    const normalized = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48);

    return normalized || fallback;
}

function uniquifyNodes(nodes: MindMapNode[]) {
    const counts = new Map<string, number>();

    return nodes.map((node, index) => {
        const base = normalizeId(node.id || node.label, `node-${index + 1}`);
        const count = counts.get(base) ?? 0;
        counts.set(base, count + 1);

        return {
            ...node,
            id: count === 0 ? base : `${base}-${count + 1}`,
            label: node.label.trim(),
            description: node.description.trim(),
        };
    });
}

function sanitizeGraph(graph: MindMapGraph): MindMapGraph {
    const originalToSanitized = new Map<string, string>();
    const nodes = uniquifyNodes(graph.nodes);

    graph.nodes.forEach((node, index) => {
        originalToSanitized.set(node.id, nodes[index]!.id);
    });

    const nodeIds = new Set(nodes.map((node) => node.id));
    const seenEdges = new Set<string>();
    const edges = graph.edges
        .map((edge) => ({
            source: originalToSanitized.get(edge.source) ?? normalizeId(edge.source, edge.source),
            target: originalToSanitized.get(edge.target) ?? normalizeId(edge.target, edge.target),
        }))
        .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
        .filter((edge) => {
            const key = `${edge.source}->${edge.target}`;
            if (edge.source === edge.target || seenEdges.has(key)) return false;
            seenEdges.add(key);
            return true;
        });

    return { nodes, edges };
}

function isHierarchical(graph: MindMapGraph) {
    const levelCounts = graph.nodes.reduce(
        (counts, node) => {
            counts[node.level] = (counts[node.level] ?? 0) + 1;
            return counts;
        },
        {} as Record<number, number>,
    );

    return (levelCounts[0] ?? 0) === 1 && (levelCounts[1] ?? 0) >= 2 && graph.edges.length >= 2;
}

function sampleChunks(chunks: DocumentChunk[]) {
    if (chunks.length <= MAX_SAMPLE_CHUNKS) return chunks;

    const selected = new Map<number, DocumentChunk>();
    const indexes = [
        0,
        chunks.length - 1,
        ...Array.from({ length: MAX_SAMPLE_CHUNKS - 2 }, (_, i) =>
            Math.round(((i + 1) * (chunks.length - 1)) / (MAX_SAMPLE_CHUNKS - 1)),
        ),
    ];

    for (const index of indexes) {
        const chunk = chunks[index];
        if (chunk) selected.set(chunk.chunk_index, chunk);
    }

    return Array.from(selected.values()).sort((a, b) => a.chunk_index - b.chunk_index);
}

function buildContext(chunks: DocumentChunk[]) {
    let remaining = MAX_CONTEXT_CHARS;
    const parts: string[] = [];

    for (const chunk of sampleChunks(chunks)) {
        if (remaining <= 0) break;

        const heading = chunk.heading ? `Heading: ${chunk.heading}\n` : '';
        const keyTerms = chunk.key_terms?.length ? `Key terms: ${chunk.key_terms.join(', ')}\n` : '';
        const block = `[Chunk ${chunk.chunk_index}]\n${heading}${keyTerms}${chunk.content}`;
        const sliced = block.slice(0, remaining);

        parts.push(sliced);
        remaining -= sliced.length;
    }

    return parts.join('\n\n---\n\n');
}

const STOPWORDS = new Set([
    'about', 'after', 'again', 'also', 'because', 'before', 'being', 'between', 'could',
    'during', 'every', 'from', 'have', 'into', 'more', 'most', 'other', 'over', 'same',
    'such', 'than', 'that', 'their', 'there', 'these', 'they', 'this', 'through', 'under',
    'using', 'were', 'when', 'where', 'which', 'while', 'with', 'would', 'your',
]);

function titleCase(value: string) {
    return value.replace(/\b[a-z]/g, (match) => match.toUpperCase());
}

function extractFallbackTerms(chunks: DocumentChunk[]) {
    const explicitTerms = chunks.flatMap((chunk) => chunk.key_terms ?? []);
    const text = chunks.map((chunk) => chunk.content).join(' ');
    const words = text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [];
    const counts = new Map<string, number>();

    for (const rawWord of words) {
        const word = rawWord.replace(/^-|-$/g, '');
        if (!word || STOPWORDS.has(word)) continue;
        counts.set(word, (counts.get(word) ?? 0) + 1);
    }

    const inferredTerms = Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([term]) => term);

    const seen = new Set<string>();
    return [...explicitTerms, ...inferredTerms]
        .map((term) => term.trim())
        .filter(Boolean)
        .filter((term) => {
            const key = term.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, FALLBACK_NODE_COUNT);
}

function fallbackGraph(chunks: DocumentChunk[], warning: string): MindMapResult {
    const terms = extractFallbackTerms(chunks);
    const source = terms.length > 0 ? terms : ['Document notes'];

    return {
        warning,
        nodes: source.map((term, index) => ({
            id: normalizeId(term, `term-${index + 1}`),
            label: titleCase(term),
            description: `Key term identified from the uploaded document: ${term}.`,
            level: 1,
        })),
        edges: [],
    };
}

function promptForMindMap(contextText: string) {
    return `You extract study mind maps from uploaded course documents.

Read the sampled document chunks and return ONLY valid JSON in this exact shape:
{
  "nodes": [
    { "id": "root", "label": "Document theme", "description": "1-2 sentence summary.", "level": 0 },
    { "id": "major-topic", "label": "Major topic", "description": "1-2 sentence explanation.", "level": 1 },
    { "id": "subtopic", "label": "Subtopic or key term", "description": "1-2 sentence explanation.", "level": 2 }
  ],
  "edges": [
    { "source": "root", "target": "major-topic" },
    { "source": "major-topic", "target": "subtopic" }
  ]
}

Rules:
- Create exactly one root node at level 0 for the document theme.
- Create 3 to 6 first-level branches for major topics when the source supports them.
- Create useful second-level subtopics or key terms under the major topics.
- Every node must include a short AI-generated description of 1-2 sentences.
- IDs must be stable lowercase slugs and edges must reference existing node IDs.
- If the source is too short or unstructured, return a flat key-term graph with level 1 nodes and no edges.
- Do not include markdown, comments, or text outside the JSON object.

DOCUMENT CHUNKS:
${contextText}`;
}

async function callGroqMindMap(contextText: string, userId?: string) {
    const { parsed } = await callLlmJson('mindmap', promptForMindMap(contextText), { userId });
    return sanitizeGraph(MindMapGraphSchema.parse(parsed));
}

export async function generateMindMap({
    documentId,
    accessToken,
    userId,
}: {
    documentId: string;
    accessToken: string;
    userId?: string;
}): Promise<MindMapResult> {
    const startedAt = Date.now();
    const supabase = getAnonSupabaseClient(accessToken);

    logMindMap.event('generate', 'fetching document chunks', { documentId });

    const { data: chunks, error: chunkError } = await supabase
        .from('document_chunks')
        .select('content, chunk_index, heading, key_terms')
        .eq('document_id', documentId)
        .order('chunk_index', { ascending: true })
        .limit(MAX_CHUNKS_TO_FETCH);

    if (chunkError) {
        logMindMap.error('generate', 'chunk fetch failed', chunkError, { documentId });
        throw new Error(`Failed to fetch chunks: ${chunkError.message}`);
    }

    if (!chunks || chunks.length === 0) {
        logMindMap.event('generate', 'no chunks found', { documentId });
        throw new Error('No content found for this document.');
    }

    const typedChunks = chunks as DocumentChunk[];
    const wordCount = typedChunks
        .map((chunk) => chunk.content)
        .join(' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean).length;

    if (wordCount < MIN_WORDS_FOR_HIERARCHY) {
        const warning = 'Document is too short to build a reliable hierarchy. Returning key terms instead.';
        logMindMap.event('generate', 'returning short-document fallback', {
            documentId,
            chunkCount: typedChunks.length,
            wordCount,
        });
        return fallbackGraph(typedChunks, warning);
    }

    const contextText = buildContext(typedChunks);
    logMindMap.event('generate', 'calling Groq for topic extraction', {
        documentId,
        chunkCount: typedChunks.length,
        sampledChunkCount: sampleChunks(typedChunks).length,
        contextChars: contextText.length,
    });

    const graph = await callGroqMindMap(contextText, userId);

    if (!isHierarchical(graph)) {
        const warning = 'Document did not contain enough clear structure for a hierarchy. Returning key terms instead.';
        logMindMap.event('generate', 'returning unstructured-document fallback', {
            documentId,
            nodeCount: graph.nodes.length,
            edgeCount: graph.edges.length,
            elapsedMs: Date.now() - startedAt,
        });
        return fallbackGraph(typedChunks, warning);
    }

    logMindMap.event('generate', 'mind map generated', {
        documentId,
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        elapsedMs: Date.now() - startedAt,
    });

    return graph;
}
