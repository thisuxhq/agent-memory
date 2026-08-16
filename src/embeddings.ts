import { profileName, sha256Hex } from "./ids";
import type { ExtractedMemory, StoredMemory } from "./types";

const EMBED_MODEL = "@cf/baai/bge-m3";

type EmbedResponse = {
  data?: number[][];
  shape?: number[];
};

export function embedTextForMemory(memory: {
  summary: string;
  content: string;
  searchQueries?: string[];
  keywords?: string[];
}): string {
  const queries = (memory.searchQueries ?? []).slice(0, 5);
  const keywords = (memory.keywords ?? []).slice(0, 8);
  return [...queries, ...keywords, memory.summary, memory.content]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

export async function vectorNamespace(namespace: string, profile: string): Promise<string> {
  const name = profileName(namespace, profile);
  if (name.length <= 64) return name;
  return sha256Hex(name, 16);
}

export async function embedTexts(env: Env, texts: string[]): Promise<number[][]> {
  if (!env.AI || texts.length === 0) return [];
  const response = (await env.AI.run(EMBED_MODEL, {
    text: texts,
  })) as EmbedResponse;
  if (!response.data?.length) {
    console.error(JSON.stringify({ event: "embed_empty", count: texts.length }));
    return [];
  }
  return response.data;
}

export async function upsertMemoryVectors(
  env: Env,
  namespace: string,
  profile: string,
  memories: Array<StoredMemory & { searchQueries?: string[]; keywords?: string[]; type: string }>,
): Promise<void> {
  if (!env.VECTORIZE || !env.AI) return;

  const indexable = memories.filter((memory) => memory.type !== "task");
  if (indexable.length === 0) return;

  const ns = await vectorNamespace(namespace, profile);
  const texts = indexable.map((memory) => embedTextForMemory(memory));
  const vectors = await embedTexts(env, texts);
  if (vectors.length !== indexable.length) return;

  await env.VECTORIZE.upsert(
    indexable.map((memory, index) => ({
      id: memory.id,
      values: vectors[index]!,
      namespace: ns,
      metadata: {
        type: memory.type,
        summary: memory.summary.slice(0, 500),
        sessionId: memory.sessionId ?? "",
        profile: profileName(namespace, profile),
      },
    })),
  );
}

export async function deleteMemoryVectors(env: Env, ids: string[]): Promise<void> {
  if (!env.VECTORIZE || ids.length === 0) return;
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    await env.VECTORIZE.deleteByIds(unique.slice(i, i + 100));
  }
}

export async function queryMemoryVectors(
  env: Env,
  namespace: string,
  profile: string,
  texts: string[],
  topK: number,
): Promise<Array<{ id: string; score: number; channel: "vector" | "hyde" }>> {
  if (!env.VECTORIZE || !env.AI) return [];

  const cleaned = texts.map((text) => text.trim()).filter(Boolean);
  if (cleaned.length === 0) return [];

  const ns = await vectorNamespace(namespace, profile);
  const vectors = await embedTexts(env, cleaned);
  if (vectors.length === 0) return [];

  const hits: Array<{ id: string; score: number; channel: "vector" | "hyde" }> = [];
  for (const [index, values] of vectors.entries()) {
    const channel = index === 0 ? "vector" : "hyde";
    const matches = await env.VECTORIZE.query(values, {
      topK,
      namespace: ns,
      returnMetadata: "none",
    });
    for (const match of matches.matches) {
      hits.push({
        id: match.id,
        score: match.score ?? 0,
        channel,
      });
    }
  }
  return hits;
}

export function buildEmbedPayload(
  stored: StoredMemory,
  source?: ExtractedMemory,
): StoredMemory & { searchQueries?: string[]; keywords?: string[]; type: string } {
  return {
    ...stored,
    searchQueries: source?.searchQueries,
    keywords: source?.keywords,
  };
}
