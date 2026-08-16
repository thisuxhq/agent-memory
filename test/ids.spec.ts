import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  messageId,
  normalizeTopicKey,
  profileName,
} from "../src/ids";

describe("ids", () => {
  it("builds stable content-addressed message ids", async () => {
    const a = await messageId("s1", "user", "hello");
    const b = await messageId("s1", "user", "hello");
    const c = await messageId("s1", "assistant", "hello");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(32);
  });

  it("normalizes topic keys", () => {
    expect(normalizeTopicKey("Package Manager!")).toBe("package-manager");
    expect(normalizeTopicKey("  ")).toBeNull();
  });

  it("scopes profiles", () => {
    expect(profileName("demo", "alice")).toBe("demo:alice");
  });

  it("round-trips cursors", () => {
    const cursor = encodeCursor(1_700_000_000_000, "abc");
    expect(decodeCursor(cursor)).toEqual({
      createdAt: 1_700_000_000_000,
      id: "abc",
    });
  });
});
