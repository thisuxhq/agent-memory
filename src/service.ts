import {
  buildEmbedPayload,
  deleteMemoryVectors,
  queryMemoryVectors,
  upsertMemoryVectors,
} from "./embeddings";
import { analyzeQuery, classifyMemory, extractMemories, synthesizeAnswer } from "./luna";
import { profileName } from "./ids";
import { verifyExtracted } from "./verify";
import { HttpError } from "./validate";
import type {
  AgentMemoryMessage,
  ExtractedMemory,
  MemoryType,
  RecallResult,
  ScoredCandidate,
  StoredMemory,
} from "./types";

export function profileStub(env: Env, namespace: string, profile: string) {
  return env.MEMORY_PROFILE.getByName(profileName(namespace, profile));
}

async function persistAndIndex(
  env: Env,
  namespace: string,
  profile: string,
  items: ExtractedMemory[],
): Promise<StoredMemory[]> {
  if (items.length === 0) return [];
  const memory = profileStub(env, namespace, profile);
  const { stored, supersededIds, sources } = await memory.storeMemories(items);
  await deleteMemoryVectors(env, supersededIds);
  await upsertMemoryVectors(
    env,
    namespace,
    profile,
    stored.map((row, index) => buildEmbedPayload(row, sources[index])),
  );
  return stored;
}

export async function ingestNow(
  env: Env,
  namespace: string,
  profile: string,
  messages: AgentMemoryMessage[],
  sessionId?: string | null,
): Promise<{ ingested: number; extracted: number }> {
  const memory = profileStub(env, namespace, profile);
  const written = await memory.writeMessages(messages, { sessionId });
  if (written.ingested === 0) return { ingested: 0, extracted: 0 };

  const extracted = verifyExtracted(
    await extractMemories(env, written.pending, written.sessionId, written.sourceIds),
    written.pending,
  );
  await persistAndIndex(env, namespace, profile, extracted);
  await memory.markExtracted(written.sourceIds);
  return { ingested: written.ingested, extracted: extracted.length };
}

export async function queueIngest(
  env: Env,
  namespace: string,
  profile: string,
  messages: AgentMemoryMessage[],
  options: { sessionId?: string | null; delaySeconds?: number } = {},
): Promise<{ ingested: number; extractAt: number }> {
  const memory = profileStub(env, namespace, profile);
  const queued = await memory.queueMessages(messages, {
    sessionId: options.sessionId,
    namespace,
    profile,
    delaySeconds: options.delaySeconds,
  });
  return { ingested: queued.ingested, extractAt: queued.extractAt };
}

export async function processExtractJob(
  env: Env,
  namespace: string,
  profile: string,
): Promise<{ extracted: number }> {
  const memory = profileStub(env, namespace, profile);
  const batches = await memory.claimPending();
  if (batches.length === 0) return { extracted: 0 };

  let extracted = 0;
  try {
    for (const batch of batches) {
      const items = verifyExtracted(
        await extractMemories(env, batch.messages, batch.sessionId, batch.sourceIds),
        batch.messages,
      );
      await persistAndIndex(env, namespace, profile, items);
      await memory.markExtracted(batch.sourceIds);
      extracted += items.length;
    }
  } catch (error) {
    await memory.releasePending(batches.flatMap((batch) => batch.sourceIds));
    throw error;
  }

  return { extracted };
}

export async function rememberNow(
  env: Env,
  namespace: string,
  profile: string,
  content: string,
  sessionId?: string | null,
): Promise<StoredMemory> {
  const classified = await classifyMemory(env, content, sessionId ?? null);
  const [stored] = await persistAndIndex(env, namespace, profile, [classified]);
  if (!stored) throw new HttpError(500, "Failed to store memory");
  return stored;
}

export async function recallNow(
  env: Env,
  namespace: string,
  profile: string,
  query: string,
  options: {
    thinkingLevel?: "low" | "medium" | "high";
    responseLength?: "short" | "medium" | "long";
    referenceDate?: string;
  } = {},
): Promise<RecallResult> {
  const thinkingLevel = options.thinkingLevel ?? "low";
  const topK = thinkingLevel === "high" ? 12 : thinkingLevel === "medium" ? 8 : 5;
  const analysis = await analyzeQuery(env, query, options.referenceDate);

  const vectorHits = await queryMemoryVectors(
    env,
    namespace,
    profile,
    [query, analysis.hyde].filter(Boolean),
    topK,
  );

  const hits = await profileStub(env, namespace, profile).search(
    query,
    analysis,
    thinkingLevel,
    vectorHits,
  );
  const answer = await synthesizeAnswer(
    env,
    query,
    hits,
    options.responseLength ?? "medium",
  );
  const candidates: ScoredCandidate[] = hits
    .filter((hit) => hit.kind === "memory")
    .slice(0, 8)
    .map((hit) => ({
      id: hit.id,
      summary: hit.summary,
      sessionId: hit.sessionId,
      score: Number(hit.rank.toFixed(4)),
    }));

  return { count: candidates.length, answer: answer || "", candidates };
}

export async function requireMemory(
  env: Env,
  namespace: string,
  profile: string,
  memoryId: string,
): Promise<StoredMemory> {
  const stored = await profileStub(env, namespace, profile).get(memoryId);
  if (!stored) throw new HttpError(404, "Memory not found");
  return stored;
}

export async function requireDeleteMemory(
  env: Env,
  namespace: string,
  profile: string,
  memoryId: string,
): Promise<StoredMemory> {
  const stored = await profileStub(env, namespace, profile).deleteMemory(memoryId);
  if (!stored) throw new HttpError(404, "Memory not found");
  await deleteMemoryVectors(env, [memoryId]);
  return stored;
}

export async function deleteSessionNow(
  env: Env,
  namespace: string,
  profile: string,
  sessionId: string,
): Promise<void> {
  const ids = await profileStub(env, namespace, profile).deleteSession(sessionId);
  await deleteMemoryVectors(env, ids);
}

export async function destroyProfileNow(
  env: Env,
  namespace: string,
  profile: string,
): Promise<void> {
  const ids = await profileStub(env, namespace, profile).destroy();
  await deleteMemoryVectors(env, ids);
}

export type ListOptions = {
  limit?: number;
  cursor?: string;
  sessionId?: string;
  type?: MemoryType;
};
