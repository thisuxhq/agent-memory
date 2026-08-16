import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

const auth = { Authorization: "Bearer test-token" };

describe("HTTP API", () => {
  it("keeps /health public", async () => {
    const res = await SELF.fetch("http://example.com/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("rejects unauthenticated profile calls", async () => {
    const res = await SELF.fetch(
      "http://example.com/namespaces/demo/profiles/alice/memories",
    );
    expect(res.status).toBe(401);
  });

  it("lists memories with a bearer token", async () => {
    const res = await SELF.fetch(
      "http://example.com/namespaces/demo/profiles/http-user/memories",
      { headers: auth },
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ memories: unknown[] }>();
    expect(Array.isArray(body.memories)).toBe(true);
  });
});
