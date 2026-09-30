import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { ParsedDocument } from "./parser";

export type { ParsedDocument };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Chunk {
    content: string;
    chunkIndex: number;
    keyTerms: string[];
    heading: string | null; // nearest heading above this chunk, if any
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 500;       // characters per chunk
const CHUNK_OVERLAP = 50;     // overlap between adjacent chunks

const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
    separators: ["\n\n", "\n", ".", " ", ""],
});

// ---------------------------------------------------------------------------
// Key term extraction
// ---------------------------------------------------------------------------
// Simple heuristic: words that are Title Case or ALL_CAPS and longer than
// 3 characters are likely domain terms. Strips common stop words.
// Swap this out for a proper NLP library (e.g. `compromise`) in Phase-2.

const STOP_WORDS = new Set([
    "the", "and", "for", "with", "this", "that", "from", "have",
    "are", "was", "were", "will", "can", "may", "but", "not", "its",
    "into", "also", "more", "when", "then", "than", "such", "each",
    "about", "they", "their", "which", "been", "being", "would",
]);

function extractKeyTerms(text: string): string[] {
    const words = text.match(/\b[A-Z][a-zA-Z]{3,}\b/g) ?? [];
    const unique = Array.from(new Set(words.map((w) => w.toLowerCase())));
    return unique.filter((w) => !STOP_WORDS.has(w)).slice(0, 10);
}

// ---------------------------------------------------------------------------
// Heading assignment
// ---------------------------------------------------------------------------
// For each chunk, find the last heading that appears before it in the
// original text. This gives the chunk topical context without restructuring
// the splitter logic.

function assignHeadings(
    rawText: string,
    chunkContents: string[],
    headings: string[]
): (string | null)[] {
    if (headings.length === 0) return chunkContents.map(() => null);

    // Map each heading to its character offset in the original text
    const headingOffsets: { heading: string; offset: number }[] = headings
        .map((h) => ({ heading: h, offset: rawText.indexOf(h) }))
        .filter((h) => h.offset !== -1)
        .sort((a, b) => a.offset - b.offset);

    return chunkContents.map((content) => {
        const chunkOffset = rawText.indexOf(content);
        if (chunkOffset === -1) return null;

        // Walk backwards through headings to find the nearest one before this chunk
        let assigned: string | null = null;
        for (const { heading, offset } of headingOffsets) {
            if (offset <= chunkOffset) assigned = heading;
            else break;
        }
        return assigned;
    });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function chunkDocument(doc: ParsedDocument): Promise<Chunk[]> {
    if (!doc.text || doc.text.trim().length === 0) {
        throw new Error("Cannot chunk an empty document.");
    }

    const rawChunks = await splitter.splitText(doc.text);

    if (rawChunks.length === 0) {
        throw new Error("Splitter returned no chunks — document may be too short.");
    }

    const headingMap = assignHeadings(doc.text, rawChunks, doc.headings);

    const chunks: Chunk[] = rawChunks.map((content, i) => ({
        content,
        chunkIndex: i,
        keyTerms: extractKeyTerms(content),
        heading: headingMap[i] ?? null,
    }));

    return chunks;
}