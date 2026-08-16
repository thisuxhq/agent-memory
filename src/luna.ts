import { normalizeTopicKey } from "./ids";
import { HttpError } from "./validate";
import type {
  AgentMemoryMessage,
  ExtractedMemory,
  MemoryType,
  QueryAnalysis,
  SearchHit,
} from "./types";
import { MEMORY_TYPES } from "./types";

const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["memories"],
  properties: {
    memories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "type",
          "topic_key",
          "summary",
          "content",
          "keywords",
          "search_queries",
        ],
        properties: {
          type: { type: "string", enum: [...MEMORY_TYPES] },
          topic_key: { type: ["string", "null"] },
          summary: { type: "string" },
          content: { type: "string" },
          keywords: { type: "array", items: { type: "string" } },
          search_queries: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

const QUERY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["topic_keys", "fts_terms", "hyde"],
  properties: {
    topic_keys: { type: "array", items: { type: "string" } },
    fts_terms: { type: "array", items: { type: "string" } },
    hyde: { type: "string" },
  },
} as const;

type LunaOptions = {
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
};

async function luna(
  env: Env,
  system: string,
  user: string,
  options: LunaOptions = {},
): Promise<string> {
  const key = env.OPENROUTER_API_KEY;
  if (!key) throw new HttpError(500, "OPENROUTER_API_KEY is not set");

  const body: Record<string, unknown> = {
    model: env.OPENROUTER_MODEL,
    temperature: 0,
    max_tokens: options.maxTokens ?? 1200,
    reasoning: { effort: "none" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  };

  if (options.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: "result",
        strict: true,
        schema: options.jsonSchema,
      },
    };
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(JSON.stringify({ event: "luna_error", status: response.status, detail }));
    throw new HttpError(502, "Memory model request failed");
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part.text ?? "").join("");
  }
  throw new HttpError(502, "Memory model returned an empty response");
}

function parseJson<T>(raw: string): T {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new HttpError(502, "Memory model returned invalid JSON");
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

function transcript(messages: AgentMemoryMessage[]): string {
  return messages
    .map((msg, index) => {
      const when = msg.timestamp ? ` @ ${msg.timestamp}` : "";
      return `[${index}] ${msg.role}${when}: ${msg.content}`;
    })
    .join("\n");
}

type RawExtracted = {
  memories: Array<{
    type: MemoryType;
    topic_key: string | null;
    summary: string;
    content: string;
    keywords: string[];
    search_queries: string[];
  }>;
};

function toExtracted(
  raw: RawExtracted,
  sessionId: string | null,
  sourceMessageIds: string[],
): ExtractedMemory[] {
  const seen = new Set<string>();
  const out: ExtractedMemory[] = [];

  for (const item of raw.memories) {
    if (!MEMORY_TYPES.includes(item.type)) continue;
    const summary = item.summary?.trim();
    const content = item.content?.trim();
    if (!summary || !content) continue;

    const topicKey =
      item.type === "fact" || item.type === "instruction"
        ? normalizeTopicKey(item.topic_key ?? summary)
        : normalizeTopicKey(item.topic_key);

    const dedupe = `${item.type}:${topicKey ?? summary}`;
    if (seen.has(dedupe)) {
      const index = out.findIndex(
        (row) => `${row.type}:${row.topicKey ?? row.summary}` === dedupe,
      );
      if (index >= 0) out.splice(index, 1);
    }
    seen.add(dedupe);

    out.push({
      type: item.type,
      topicKey,
      summary: summary.slice(0, 280),
      content,
      keywords: (item.keywords ?? []).map((word) => word.trim()).filter(Boolean).slice(0, 12),
      searchQueries: (item.search_queries ?? [])
        .map((query) => query.trim())
        .filter(Boolean)
        .slice(0, 5),
      sessionId,
      sourceMessageIds,
    });
  }

  return out;
}

export async function extractMemories(
  env: Env,
  messages: AgentMemoryMessage[],
  sessionId: string | null,
  sourceMessageIds: string[],
): Promise<ExtractedMemory[]> {
  const now = new Date().toISOString();
  const raw = parseJson<RawExtracted>(
    await luna(
      env,
      `You extract durable agent memory from a conversation.
Today is ${now}. Resolve relative dates to absolute ISO dates.
Extract only standalone knowledge that will matter in a later session.
Do not invent facts. If nothing is durable, return {"memories":[]}.

Types:
- fact: stable current truth (preferences, identity, tools, goals). Needs a topic_key.
- event: something that happened at a time. No topic_key required.
- instruction: how the user wants work done. Needs a topic_key.
- task: short-lived work in this session only.

Each memory must have a short summary, full content, keywords, and 3-5 interrogative search_queries.`,
      transcript(messages),
      { jsonSchema: EXTRACT_SCHEMA, maxTokens: 2000 },
    ),
  );
  return toExtracted(raw, sessionId, sourceMessageIds);
}

export async function classifyMemory(
  env: Env,
  content: string,
  sessionId: string | null,
): Promise<ExtractedMemory> {
  const now = new Date().toISOString();
  const raw = parseJson<RawExtracted>(
    await luna(
      env,
      `Classify one explicit memory. Today is ${now}.
Return exactly one item in memories. Do not invent extra facts.`,
      content,
      { jsonSchema: EXTRACT_SCHEMA, maxTokens: 800 },
    ),
  );
  const [first] = toExtracted(raw, sessionId, []);
  if (!first) {
    return {
      type: "fact",
      topicKey: normalizeTopicKey(content),
      summary: content.slice(0, 280),
      content,
      keywords: [],
      searchQueries: [],
      sessionId,
      sourceMessageIds: [],
    };
  }
  first.content = content;
  return first;
}

export async function analyzeQuery(env: Env, query: string, referenceDate?: string): Promise<QueryAnalysis> {
  const now = referenceDate ?? new Date().toISOString();
  const raw = parseJson<{
    topic_keys: string[];
    fts_terms: string[];
    hyde: string;
  }>(
    await luna(
      env,
      `Analyze a memory search query. Today is ${now}.
Return:
- topic_keys: normalized kebab-case keys that might match stored facts/instructions
- fts_terms: keywords and synonyms for full-text search
- hyde: one declarative sentence written as if it were the stored memory that answers the query`,
      query,
      { jsonSchema: QUERY_SCHEMA, maxTokens: 400 },
    ),
  );

  return {
    topicKeys: (raw.topic_keys ?? []).map((key) => normalizeTopicKey(key)).filter((key): key is string => Boolean(key)),
    ftsTerms: (raw.fts_terms ?? []).map((term) => term.trim()).filter(Boolean).slice(0, 12),
    hyde: raw.hyde?.trim() ?? "",
  };
}

export async function synthesizeAnswer(
  env: Env,
  query: string,
  hits: SearchHit[],
  responseLength: "short" | "medium" | "long" = "medium",
): Promise<string> {
  if (hits.length === 0) return "";

  const budget =
    responseLength === "short" ? 80 : responseLength === "long" ? 320 : 160;

  const context = hits
    .map((hit, index) => {
      const kind = hit.kind === "memory" ? hit.type ?? "memory" : "message";
      return `${index + 1}. [${kind}] ${hit.summary}\n${hit.content}`;
    })
    .join("\n\n");

  const answer = (
    await luna(
      env,
      `Answer using only the stored memories below.
If they do not answer the question, return an empty string and nothing else.
Do not invent. Keep the answer ${responseLength}.`,
      `Question: ${query}\n\nMemories:\n${context}`,
      { maxTokens: budget },
    )
  ).trim();

  if (/^no relevant|^none$|^n\/a$|^empty$/i.test(answer)) return "";
  return answer;
}
