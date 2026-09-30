import { extractText } from "unpdf";

export interface ParsedDocument {
  text: string;
  headings: string[];
}

function cleanText(raw: string): string {
  let text = raw.replace(/\n{3,}/g, "\n\n");
  text = text.replace(/ {2,}/g, " ");
  text = text.replace(/\n\s*\d+\s*\n/g, "\n");
  text = text.replace(/Page \d+ of \d+/gi, "");
  return text.trim();
}

function extractHeadings(text: string): string[] {
  const lines = text.split("\n");
  const headings: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.length > 100) continue;
    if (line.endsWith(".")) continue;
    if (/^\d+$/.test(line)) continue;

    const isNumbered = /^\d+(\.\d+)*\.?\s+\S/.test(line);
    const isAllCaps = line === line.toUpperCase() && /[A-Z]/.test(line);
    const words = line.split(/\s+/);
    const titleCaseCount = words.filter((w) => /^[A-Z]/.test(w)).length;
    const isTitleCase = words.length >= 2 && titleCaseCount / words.length >= 0.6;

    if (isNumbered || isAllCaps || isTitleCase) {
      headings.push(line);
    }
  }

  return headings;
}

export async function parsePDFFromBuffer(
  buffer: Buffer
): Promise<ParsedDocument> {
  const { text: rawText } = await extractText(new Uint8Array(buffer), { mergePages: true });

  if (!rawText || rawText.trim().length === 0) {
    throw new Error(
      "No text found in PDF. It might be a scanned/image-only PDF. " +
        "Please upload a text-based version."
    );
  }

  const cleanedText = cleanText(rawText);
  const headings = extractHeadings(cleanedText);

  return {
    text: cleanedText,
    headings,
  };
}
