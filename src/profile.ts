import { DurableObject } from "cloudflare:workers";
import {
  decodeCursor,
  deriveSessionId,
  encodeCursor,
  messageId,
  sha256Hex,
} from "./ids";
import type {
  AgentMemoryMessage,
  ExtractedMemory,
  MemoryListEntry,
  MemoryType,
  QueryAnalysis,
  SearchHit,
  StoredMemory,
} from "./types";

type MemoryRow = {
  id: string;
  type: MemoryType;
  topic_key: string | null;
  summary: string;
  content: string;
  keywords: string;
  search_queries: string;
  session_id: string | null;
  superseded_by: string | null;
  created_at: number;
  updated_at: number;
};

type MessageRow = {
  id: string;
  session_id: string | null;
  role: AgentMemoryMessage["role"];
  content: string;
  created_at: number;
  extracted: number;
};

export type WriteResult = {
  sessionId: string;
  ingested: number;
  sourceIds: string[];
  pending: AgentMemoryMessage[];
};

export type PendingBatch = {
  sessionId: string;
  messages: AgentMemoryMessage[];
  sourceIds: string[];
};

const CHANNEL_WEIGHT: Record<SearchHit["channel"], number> = {
  topic: 1.0,
  memory_fts: 0.7,
  message_fts: 0.3,
};

export class MemoryProfile extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const current = sql
      .exec<{ version: number }>(
        "SELECT COALESCE(MAX(id), 0) as version FROM _sql_schema_migrations",
      )
      .one().version;

    if (current < 1) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT,
          role TEXT NOT NULL,
          content TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          topic_key TEXT,
          summary TEXT NOT NULL,
          content TEXT NOT NULL,
          keywords TEXT NOT NULL DEFAULT '[]',
          search_queries TEXT NOT NULL DEFAULT '[]',
          session_id TEXT,
          superseded_by TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_memories_topic ON memories(topic_key);
        CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          summary, content, keywords, tokenize='porter'
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content, tokenize='porter'
        );
        INSERT INTO _sql_schema_migrations (id) VALUES (1);
      `);
    }

    if (current < 2) {
      sql.exec(`
        ALTER TABLE messages ADD COLUMN extracted INTEGER NOT NULL DEFAULT 0;
        CREATE INDEX IF NOT EXISTS idx_messages_extracted ON messages(extracted);
        INSERT INTO _sql_schema_migrations (id) VALUES (2);
      `);
    }
  }

  async writeMessages(
    messages: AgentMemoryMessage[],
    options: { sessionId?: string | null } = {},
  ): Promise<WriteResult> {
    const sessionId = options.sessionId ?? (await deriveSessionId(messages));
    const now = Date.now();
    const sourceIds: string[] = [];
    const pending: AgentMemoryMessage[] = [];

    for (const message of messages) {
      const id = await messageId(sessionId, message.role, message.content);
      sourceIds.push(id);
      const createdAt = message.timestamp ? Date.parse(message.timestamp) || now : now;
      const result = this.ctx.storage.sql.exec(
        "INSERT OR IGNORE INTO messages (id, session_id, role, content, created_at, extracted) VALUES (?, ?, ?, ?, ?, 0)",
        id,
        sessionId,
        message.role,
        message.content,
        createdAt,
      );
      if (result.rowsWritten > 0) {
        this.ctx.storage.sql.exec(
          "INSERT INTO messages_fts (rowid, content) VALUES ((SELECT rowid FROM messages WHERE id = ?), ?)",
          id,
          message.content,
        );
        pending.push(message);
      }
    }

    return { sessionId, ingested: pending.length, sourceIds, pending };
  }

  async queueMessages(
    messages: AgentMemoryMessage[],
    options: {
      sessionId?: string | null;
      namespace: string;
      profile: string;
      delaySeconds?: number;
    },
  ): Promise<WriteResult & { extractAt: number }> {
    const written = await this.writeMessages(messages, options);
    await this.ctx.storage.put("namespace", options.namespace);
    await this.ctx.storage.put("profile", options.profile);
    const delayMs = Math.max(1, options.delaySeconds ?? 10) * 1000;
    const extractAt = Date.now() + delayMs;
    await this.ctx.storage.setAlarm(extractAt);
    return { ...written, extractAt };
  }

  async alarm(): Promise<void> {
    const namespace = await this.ctx.storage.get<string>("namespace");
    const profile = await this.ctx.storage.get<string>("profile");
    if (!namespace || !profile) return;
    await this.env.EXTRACT_QUEUE.send({ namespace, profile });
  }

  async claimPending(): Promise<PendingBatch[]> {
    const rows = this.ctx.storage.sql
      .exec<MessageRow>(
        "SELECT * FROM messages WHERE extracted = 0 ORDER BY created_at ASC, id ASC",
      )
      .toArray();

    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);
    for (const id of ids) {
      this.ctx.storage.sql.exec(
        "UPDATE messages SET extracted = 2 WHERE id = ? AND extracted = 0",
        id,
      );
    }

    const groups = new Map<string, PendingBatch>();
    for (const row of rows) {
      const sessionId = row.session_id ?? "unknown";
      const group = groups.get(sessionId) ?? {
        sessionId,
        messages: [],
        sourceIds: [],
      };
      group.messages.push({
        role: row.role,
        content: row.content,
        timestamp: new Date(row.created_at).toISOString(),
      });
      group.sourceIds.push(row.id);
      groups.set(sessionId, group);
    }
    return [...groups.values()];
  }

  async markExtracted(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.ctx.storage.sql.exec("UPDATE messages SET extracted = 1 WHERE id = ?", id);
    }
  }

  async releasePending(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.ctx.storage.sql.exec(
        "UPDATE messages SET extracted = 0 WHERE id = ? AND extracted = 2",
        id,
      );
    }
  }

  async storeMemories(items: ExtractedMemory[]): Promise<StoredMemory[]> {
    const stored: StoredMemory[] = [];
    for (const item of items) {
      stored.push(await this.persistMemory(item));
    }
    return stored;
  }

  async search(
    query: string,
    analysis: QueryAnalysis,
    thinkingLevel: "low" | "medium" | "high" = "low",
  ): Promise<SearchHit[]> {
    const limit = thinkingLevel === "high" ? 16 : thinkingLevel === "medium" ? 10 : 6;
    const hits: SearchHit[] = [];

    for (const [index, key] of analysis.topicKeys.entries()) {
      const rows = this.ctx.storage.sql
        .exec<MemoryRow>(
          "SELECT * FROM memories WHERE topic_key = ? AND superseded_by IS NULL LIMIT 5",
          key,
        )
        .toArray();
      for (const row of rows) {
        hits.push(fromMemory(row, "topic", index + 1));
      }
    }

    const memoryQuery = ftsQuery([query, ...analysis.ftsTerms, analysis.hyde]);
    if (memoryQuery) {
      const rows = this.ctx.storage.sql
        .exec<MemoryRow>(
          `SELECT m.* FROM memories_fts
           JOIN memories m ON m.rowid = memories_fts.rowid
           WHERE memories_fts MATCH ? AND m.superseded_by IS NULL
           ORDER BY rank
           LIMIT ?`,
          memoryQuery,
          limit,
        )
        .toArray();
      rows.forEach((row, index) => hits.push(fromMemory(row, "memory_fts", index + 1)));
    }

    const messageQuery = ftsQuery([query, ...analysis.ftsTerms]);
    if (messageQuery) {
      const rows = this.ctx.storage.sql
        .exec<MessageRow>(
          `SELECT msg.* FROM messages_fts
           JOIN messages msg ON msg.rowid = messages_fts.rowid
           WHERE messages_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
          messageQuery,
          Math.max(4, Math.floor(limit / 2)),
        )
        .toArray();
      rows.forEach((row, index) => {
        hits.push({
          id: row.id,
          kind: "message",
          type: null,
          summary: row.content.slice(0, 160),
          content: row.content,
          sessionId: row.session_id,
          createdAt: row.created_at,
          channel: "message_fts",
          rank: index + 1,
        });
      });
    }

    return fuse(hits, limit);
  }

  async list(options: {
    limit?: number;
    cursor?: string;
    sessionId?: string;
    type?: MemoryType;
  } = {}): Promise<{ memories: MemoryListEntry[]; cursor?: string }> {
    const limit = options.limit ?? 20;
    const params: Array<string | number> = [];
    let where = "superseded_by IS NULL";

    if (options.sessionId) {
      where += " AND session_id = ?";
      params.push(options.sessionId);
    }
    if (options.type) {
      where += " AND type = ?";
      params.push(options.type);
    }
    if (options.cursor) {
      const cursor = decodeCursor(options.cursor);
      where += " AND (created_at < ? OR (created_at = ? AND id < ?))";
      params.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }

    const rows = this.ctx.storage.sql
      .exec<MemoryRow>(
        `SELECT * FROM memories WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ?`,
        ...params,
        limit + 1,
      )
      .toArray();

    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      memories: page.map(toListEntry),
      cursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : undefined,
    };
  }

  async get(memoryId: string): Promise<StoredMemory | null> {
    const row = this.ctx.storage.sql
      .exec<MemoryRow>("SELECT * FROM memories WHERE id = ?", memoryId)
      .toArray()[0];
    return row ? toStored(row) : null;
  }

  async deleteMemory(memoryId: string): Promise<StoredMemory | null> {
    const row = this.ctx.storage.sql
      .exec<MemoryRow>("SELECT * FROM memories WHERE id = ?", memoryId)
      .toArray()[0];
    if (!row) return null;

    this.ctx.storage.sql.exec(
      "DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)",
      memoryId,
    );
    this.ctx.storage.sql.exec("DELETE FROM memories WHERE id = ?", memoryId);
    return toStored(row);
  }

  async deleteSession(sessionId: string): Promise<void> {
    const memories = this.ctx.storage.sql
      .exec<{ id: string }>("SELECT id FROM memories WHERE session_id = ?", sessionId)
      .toArray();
    for (const memory of memories) {
      this.ctx.storage.sql.exec(
        "DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)",
        memory.id,
      );
    }
    this.ctx.storage.sql.exec("DELETE FROM memories WHERE session_id = ?", sessionId);

    const messages = this.ctx.storage.sql
      .exec<{ id: string }>("SELECT id FROM messages WHERE session_id = ?", sessionId)
      .toArray();
    for (const message of messages) {
      this.ctx.storage.sql.exec(
        "DELETE FROM messages_fts WHERE rowid = (SELECT rowid FROM messages WHERE id = ?)",
        message.id,
      );
    }
    this.ctx.storage.sql.exec("DELETE FROM messages WHERE session_id = ?", sessionId);
  }

  async destroy(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }

  async summary(options: { sessionId?: string | null } = {}): Promise<{ summary: string }> {
    const facts = this.activeByType("fact");
    const events = this.activeByType("event");
    const instructions = this.activeByType("instruction");
    const tasks = this.activeByType("task");

    const sessionId =
      options.sessionId ??
      this.ctx.storage.sql
        .exec<{ session_id: string | null }>(
          "SELECT session_id FROM messages ORDER BY created_at DESC LIMIT 1",
        )
        .toArray()[0]?.session_id ??
      null;

    const lastSession = sessionId
      ? this.ctx.storage.sql
          .exec<MemoryRow>(
            "SELECT * FROM memories WHERE session_id = ? AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 20",
            sessionId,
          )
          .toArray()
      : [];

    const section = (title: string, rows: MemoryRow[]) =>
      rows.length === 0
        ? `## ${title}\n\nNone.`
        : `## ${title}\n\n${rows.map((row) => `- ${row.summary}`).join("\n")}`;

    return {
      summary: [
        section("Facts", facts),
        section("Events", events),
        section("Instructions", instructions),
        section("Tasks", tasks),
        section("Last Session", lastSession),
      ].join("\n\n"),
    };
  }

  private activeByType(type: MemoryType): MemoryRow[] {
    return this.ctx.storage.sql
      .exec<MemoryRow>(
        "SELECT * FROM memories WHERE type = ? AND superseded_by IS NULL ORDER BY updated_at DESC LIMIT 50",
        type,
      )
      .toArray();
  }

  private async persistMemory(item: ExtractedMemory): Promise<StoredMemory> {
    const now = Date.now();
    const id = await sha256Hex(
      `${item.type}\0${item.topicKey ?? ""}\0${item.summary}\0${item.content}\0${item.sessionId ?? ""}`,
    );

    const existing = this.ctx.storage.sql
      .exec<MemoryRow>("SELECT * FROM memories WHERE id = ?", id)
      .toArray()[0];
    if (existing) return toStored(existing);

    if (item.topicKey && (item.type === "fact" || item.type === "instruction")) {
      const previous = this.ctx.storage.sql
        .exec<MemoryRow>(
          "SELECT * FROM memories WHERE topic_key = ? AND type = ? AND superseded_by IS NULL",
          item.topicKey,
          item.type,
        )
        .toArray();
      for (const row of previous) {
        this.ctx.storage.sql.exec(
          "UPDATE memories SET superseded_by = ?, updated_at = ? WHERE id = ?",
          id,
          now,
          row.id,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)",
          row.id,
        );
      }
    }

    this.ctx.storage.sql.exec(
      `INSERT INTO memories (
        id, type, topic_key, summary, content, keywords, search_queries,
        session_id, superseded_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      id,
      item.type,
      item.topicKey,
      item.summary,
      item.content,
      JSON.stringify(item.keywords),
      JSON.stringify(item.searchQueries),
      item.sessionId,
      now,
      now,
    );
    this.ctx.storage.sql.exec(
      "INSERT INTO memories_fts (rowid, summary, content, keywords) VALUES ((SELECT rowid FROM memories WHERE id = ?), ?, ?, ?)",
      id,
      item.summary,
      item.content,
      item.keywords.join(" "),
    );

    return {
      id,
      type: item.type,
      summary: item.summary,
      content: item.content,
      sessionId: item.sessionId,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    };
  }
}

function fromMemory(row: MemoryRow, channel: SearchHit["channel"], rank: number): SearchHit {
  return {
    id: row.id,
    kind: "memory",
    type: row.type,
    summary: row.summary,
    content: row.content,
    sessionId: row.session_id,
    createdAt: row.created_at,
    channel,
    rank,
  };
}

function fuse(hits: SearchHit[], limit: number): SearchHit[] {
  const scores = new Map<string, { hit: SearchHit; score: number }>();
  for (const hit of hits) {
    const key = `${hit.kind}:${hit.id}`;
    const add = CHANNEL_WEIGHT[hit.channel] / (60 + hit.rank);
    const current = scores.get(key);
    if (current) {
      current.score += add;
      if (hit.createdAt > current.hit.createdAt) current.hit = hit;
    } else {
      scores.set(key, { hit, score: add });
    }
  }

  return [...scores.values()]
    .sort((a, b) => b.score - a.score || b.hit.createdAt - a.hit.createdAt)
    .slice(0, limit)
    .map((entry) => ({ ...entry.hit, rank: entry.score }));
}

function ftsQuery(parts: string[]): string | null {
  const terms = parts
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 1)
    .slice(0, 12);
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"`).join(" OR ");
}

function toStored(row: MemoryRow): StoredMemory {
  return {
    id: row.id,
    type: row.type,
    summary: row.summary,
    content: row.content,
    sessionId: row.session_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function toListEntry(row: MemoryRow): MemoryListEntry {
  const { content: _content, ...rest } = toStored(row);
  return rest;
}
