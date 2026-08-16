export type MemoryType = "fact" | "event" | "instruction" | "task";
export type MessageRole = "system" | "user" | "assistant";

export type AgentMemoryMessage = {
  role: MessageRole;
  content: string;
  timestamp?: string;
};

export type ExtractedMemory = {
  type: MemoryType;
  topicKey: string | null;
  summary: string;
  content: string;
  keywords: string[];
  searchQueries: string[];
  sessionId: string | null;
  sourceMessageIds: string[];
};

export type StoredMemory = {
  id: string;
  type: MemoryType;
  summary: string;
  content: string;
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MemoryListEntry = Omit<StoredMemory, "content">;

export type ScoredCandidate = {
  id: string;
  summary: string;
  sessionId: string | null;
  score: number;
};

export type RecallResult = {
  count: number;
  answer: string;
  candidates: ScoredCandidate[];
};

export type QueryAnalysis = {
  topicKeys: string[];
  ftsTerms: string[];
  hyde: string;
};

export type SearchHit = {
  id: string;
  kind: "memory" | "message";
  type: MemoryType | null;
  summary: string;
  content: string;
  sessionId: string | null;
  createdAt: number;
  channel: "topic" | "memory_fts" | "message_fts" | "vector" | "hyde";
  rank: number;
};

export const MEMORY_TYPES: readonly MemoryType[] = [
  "fact",
  "event",
  "instruction",
  "task",
];

export const MESSAGE_ROLES: readonly MessageRole[] = [
  "system",
  "user",
  "assistant",
];
