import { describe, expect, it } from "vitest";
import { embedTextForMemory, vectorNamespace } from "../src/embeddings";

describe("embeddings helpers", () => {
  it("prepends search queries for better retrieval", () => {
    const text = embedTextForMemory({
      summary: "Prefers dark mode",
      content: "User wants dark theme by default.",
      searchQueries: ["what theme does the user want?"],
      keywords: ["dark", "theme"],
    });
    expect(text.startsWith("what theme does the user want?")).toBe(true);
    expect(text).toContain("Prefers dark mode");
  });

  it("keeps short profile namespaces intact", async () => {
    expect(await vectorNamespace("demo", "alice")).toBe("demo:alice");
  });
});
