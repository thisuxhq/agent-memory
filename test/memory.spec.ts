import { env, runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { profileStub } from "../src/service";
import type { ExtractedMemory } from "../src/types";

function fact(
  topicKey: string,
  summary: string,
  content: string,
  sessionId = "s1",
): ExtractedMemory {
  return {
    type: "fact",
    topicKey,
    summary,
    content,
    keywords: [topicKey],
    searchQueries: [`what is the ${topicKey}?`],
    sessionId,
    sourceMessageIds: [],
  };
}

describe("MemoryProfile storage", () => {
  it("is idempotent for the same messages", async () => {
    const memory = profileStub(env, "demo", "idempotent");
    const messages = [
      { role: "user" as const, content: "Use pnpm." },
      { role: "assistant" as const, content: "Switching to pnpm." },
    ];

    const first = await memory.writeMessages(messages, { sessionId: "chat-1" });
    const second = await memory.writeMessages(messages, { sessionId: "chat-1" });

    expect(first.ingested).toBe(2);
    expect(second.ingested).toBe(0);
    expect(second.sourceIds).toEqual(first.sourceIds);
  });

  it("keeps Alice and Bob isolated", async () => {
    const alice = profileStub(env, "demo", "alice");
    const bob = profileStub(env, "demo", "bob");

    await alice.storeMemories([
      fact("editor", "Alice uses Neovim", "Alice prefers Neovim."),
    ]);
    await bob.storeMemories([
      fact("editor", "Bob uses VS Code", "Bob prefers VS Code."),
    ]);

    const aliceHits = await alice.search("editor preference", {
      topicKeys: ["editor"],
      ftsTerms: ["editor", "preference"],
      hyde: "Alice prefers Neovim.",
    });
    const bobHits = await bob.search("editor preference", {
      topicKeys: ["editor"],
      ftsTerms: ["editor", "preference"],
      hyde: "Bob prefers VS Code.",
    });

    expect(aliceHits.some((hit) => hit.content.includes("Neovim"))).toBe(true);
    expect(aliceHits.some((hit) => hit.content.includes("VS Code"))).toBe(false);
    expect(bobHits.some((hit) => hit.content.includes("VS Code"))).toBe(true);
    expect(bobHits.some((hit) => hit.content.includes("Neovim"))).toBe(false);
  });

  it("supersedes older facts on the same topic key", async () => {
    const memory = profileStub(env, "demo", "package-user");

    await memory.storeMemories([
      fact("package-manager", "Uses npm", "The user prefers npm."),
    ]);
    await memory.storeMemories([
      fact("package-manager", "Uses pnpm", "The user prefers pnpm."),
    ]);

    const listed = await memory.list({ type: "fact" });
    expect(listed.memories).toHaveLength(1);
    expect(listed.memories[0]?.summary).toBe("Uses pnpm");

    const hits = await memory.search("package manager", {
      topicKeys: ["package-manager"],
      ftsTerms: ["package", "manager", "pnpm"],
      hyde: "The user prefers pnpm.",
    });
    expect(hits[0]?.content).toContain("pnpm");
    expect(hits.some((hit) => hit.content.includes("npm") && !hit.content.includes("pnpm"))).toBe(
      false,
    );
  });

  it("queues extract work after the idle delay alarm", async () => {
    const memory = profileStub(env, "demo", "queued");
    const queued = await memory.queueMessages(
      [{ role: "user", content: "Remember that I like dark mode." }],
      {
        sessionId: "chat-idle",
        namespace: "demo",
        profile: "queued",
        delaySeconds: 10,
      },
    );

    expect(queued.ingested).toBe(1);
    expect(queued.extractAt).toBeGreaterThan(Date.now());

    const pendingBefore = await memory.claimPending();
    expect(pendingBefore).toHaveLength(1);
    await memory.releasePending(pendingBefore.flatMap((batch) => batch.sourceIds));

    const ran = await runDurableObjectAlarm(memory);
    expect(ran).toBe(true);
  });
});
