import { MEMORY_TYPES, MESSAGE_ROLES, type AgentMemoryMessage } from "./types";
import { utf8Bytes } from "./ids";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const NAME_RE = /^[A-Za-z0-9._:-]{1,100}$/;

export function requireName(value: string, label: string): string {
  if (!NAME_RE.test(value)) {
    throw new HttpError(400, `${label} must be 1-100 chars: letters, numbers, . _ : -`);
  }
  return value;
}

export function requireSessionId(value: string | null | undefined): string | null {
  if (value == null || value === "") return null;
  if (value.length > 64) throw new HttpError(400, "sessionId must be <= 64 characters");
  return value;
}

export function requireQuery(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "query is required");
  }
  if (utf8Bytes(value) > 1024) throw new HttpError(400, "query must be <= 1 KB");
  return value.trim();
}

export function requireMessages(value: unknown): AgentMemoryMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, "messages must be a non-empty array");
  }
  if (value.length > 500) throw new HttpError(400, "messages must be <= 500 per ingest");

  return value.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new HttpError(400, `messages[${index}] is invalid`);
    }
    const row = item as Record<string, unknown>;
    if (!MESSAGE_ROLES.includes(row.role as AgentMemoryMessage["role"])) {
      throw new HttpError(400, `messages[${index}].role is invalid`);
    }
    if (typeof row.content !== "string" || row.content.trim() === "") {
      throw new HttpError(400, `messages[${index}].content is required`);
    }
    if (utf8Bytes(row.content) > 32_768) {
      throw new HttpError(400, `messages[${index}].content must be <= 32 KB`);
    }
    const timestamp =
      typeof row.timestamp === "string"
        ? row.timestamp
        : row.timestamp instanceof Date
          ? row.timestamp.toISOString()
          : undefined;
    return {
      role: row.role as AgentMemoryMessage["role"],
      content: row.content,
      timestamp,
    };
  });
}

export function requireMemoryType(value: unknown): (typeof MEMORY_TYPES)[number] | undefined {
  if (value == null) return undefined;
  if (!MEMORY_TYPES.includes(value as (typeof MEMORY_TYPES)[number])) {
    throw new HttpError(400, "type must be fact, event, instruction, or task");
  }
  return value as (typeof MEMORY_TYPES)[number];
}

export function requireContent(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "content is required");
  }
  if (utf8Bytes(value) > 32_768) throw new HttpError(400, "content must be <= 32 KB");
  return value.trim();
}

export function parseLimit(value: string | null, fallback = 20): number {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 500) {
    throw new HttpError(400, "limit must be an integer from 1 to 500");
  }
  return n;
}
