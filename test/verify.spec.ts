import { describe, expect, it } from "vitest";
import { verifyExtracted } from "../src/verify";
import type { ExtractedMemory } from "../src/types";

const base: ExtractedMemory = {
  type: "fact",
  topicKey: "color",
  summary: "Favorite color is blue",
  content: "The user likes blue.",
  keywords: ["blue"],
  searchQueries: ["favorite color?"],
  sessionId: "s1",
  sourceMessageIds: [],
};

describe("verifyExtracted", () => {
  it("keeps grounded memories", () => {
    const out = verifyExtracted([base], [
      { role: "user", content: "I like blue a lot." },
    ]);
    expect(out).toHaveLength(1);
  });

  it("drops empty and ungrounded memories", () => {
    const out = verifyExtracted(
      [
        { ...base, summary: "", content: "" },
        {
          ...base,
          summary: "Lives on Mars",
          content: "The user lives on Mars permanently.",
          keywords: ["mars"],
        },
      ],
      [{ role: "user", content: "I like blue a lot." }],
    );
    expect(out).toHaveLength(0);
  });
});
