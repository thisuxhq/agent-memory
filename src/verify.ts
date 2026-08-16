import type { AgentMemoryMessage, ExtractedMemory } from "./types";

/**
 * Lightweight verifier (Slice 3 lite).
 * Drops empty / invented-looking items and trims junk.
 * Not the full 8-check CF pipeline.
 */
export function verifyExtracted(
  items: ExtractedMemory[],
  messages: AgentMemoryMessage[],
): ExtractedMemory[] {
  const transcript = messages.map((message) => message.content.toLowerCase()).join("\n");
  const out: ExtractedMemory[] = [];

  for (const item of items) {
    const summary = item.summary.trim();
    const content = item.content.trim();
    if (summary.length < 3 || content.length < 3) continue;
    if (/as an ai|i cannot|no information/i.test(content)) continue;

    // Prefer memories grounded in the transcript when possible.
    const tokens = content
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3);
    const grounded =
      tokens.length === 0 ||
      tokens.some((token) => transcript.includes(token)) ||
      summary
        .toLowerCase()
        .split(/\s+/)
        .some((token) => token.length > 3 && transcript.includes(token));

    if (!grounded) continue;

    out.push({
      ...item,
      summary: summary.slice(0, 280),
      content,
      keywords: item.keywords.filter(Boolean).slice(0, 12),
      searchQueries: item.searchQueries.filter(Boolean).slice(0, 5),
    });
  }

  return out;
}
