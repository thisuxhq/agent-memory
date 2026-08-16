import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { MemoryProfile } from "./profile";
import { profileName } from "./ids";
import {
  HttpError,
  parseLimit,
  requireContent,
  requireMemoryType,
  requireMessages,
  requireName,
  requireQuery,
  requireSessionId,
} from "./validate";

export { MemoryProfile };

type AppEnv = { Bindings: Env };

const app = new Hono<AppEnv>();

function stub(env: Env, namespace: string, profile: string) {
  return env.MEMORY_PROFILE.getByName(profileName(namespace, profile));
}

async function readJson(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  try {
    return (await c.req.json()) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ error: error.message }, error.status as 400);
  }
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }
  console.error(JSON.stringify({ event: "unhandled", error: String(error) }));
  return c.json({ error: "Internal error" }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.get("/health", (c) => c.json({ ok: true }));

const profiles = new Hono<AppEnv>();

profiles.use("/:namespace/profiles/:profile/*", async (c, next) => {
  requireName(c.req.param("namespace"), "namespace");
  requireName(c.req.param("profile"), "profile");
  await next();
});

profiles.use("/:namespace/profiles/:profile", async (c, next) => {
  requireName(c.req.param("namespace"), "namespace");
  requireName(c.req.param("profile"), "profile");
  await next();
});

profiles.delete("/:namespace/profiles/:profile", async (c) => {
  await stub(c.env, c.req.param("namespace"), c.req.param("profile")).destroy();
  return c.json({ ok: true });
});

profiles.post("/:namespace/profiles/:profile/ingest", async (c) => {
  const body = await readJson(c);
  const result = await stub(c.env, c.req.param("namespace"), c.req.param("profile")).ingest(
    requireMessages(body.messages),
    {
      sessionId: requireSessionId(typeof body.sessionId === "string" ? body.sessionId : null),
    },
  );
  return c.json(result);
});

profiles.post("/:namespace/profiles/:profile/remember", async (c) => {
  const body = await readJson(c);
  const stored = await stub(c.env, c.req.param("namespace"), c.req.param("profile")).remember(
    requireContent(body.content),
    {
      sessionId: requireSessionId(typeof body.sessionId === "string" ? body.sessionId : null),
    },
  );
  return c.json(stored);
});

profiles.post("/:namespace/profiles/:profile/recall", async (c) => {
  const body = await readJson(c);
  const result = await stub(c.env, c.req.param("namespace"), c.req.param("profile")).recall(
    requireQuery(body.query),
    {
      thinkingLevel:
        body.thinkingLevel === "medium" || body.thinkingLevel === "high"
          ? body.thinkingLevel
          : "low",
      responseLength:
        body.responseLength === "short" || body.responseLength === "long"
          ? body.responseLength
          : "medium",
      referenceDate: typeof body.referenceDate === "string" ? body.referenceDate : undefined,
    },
  );
  return c.json(result);
});

profiles.post("/:namespace/profiles/:profile/summary", async (c) => {
  const raw = await c.req.text();
  let body: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new HttpError(400, "Invalid JSON body");
    }
  }
  const result = await stub(c.env, c.req.param("namespace"), c.req.param("profile")).summary({
    sessionId: requireSessionId(typeof body.sessionId === "string" ? body.sessionId : null),
  });
  return c.json(result);
});

profiles.get("/:namespace/profiles/:profile/memories", async (c) => {
  const result = await stub(c.env, c.req.param("namespace"), c.req.param("profile")).list({
    limit: parseLimit(c.req.query("limit") ?? null),
    cursor: c.req.query("cursor"),
    sessionId: c.req.query("sessionId"),
    type: requireMemoryType(c.req.query("type")),
  });
  return c.json(result);
});

profiles.get("/:namespace/profiles/:profile/memories/:memoryId", async (c) => {
  return c.json(
    await stub(c.env, c.req.param("namespace"), c.req.param("profile")).get(
      c.req.param("memoryId"),
    ),
  );
});

profiles.delete("/:namespace/profiles/:profile/memories/:memoryId", async (c) => {
  return c.json(
    await stub(c.env, c.req.param("namespace"), c.req.param("profile")).deleteMemory(
      c.req.param("memoryId"),
    ),
  );
});

profiles.delete("/:namespace/profiles/:profile/sessions/:sessionId", async (c) => {
  const sessionId = requireSessionId(c.req.param("sessionId")) ?? c.req.param("sessionId");
  await stub(c.env, c.req.param("namespace"), c.req.param("profile")).deleteSession(sessionId);
  return c.json({ ok: true });
});

app.route("/namespaces", profiles);

export default app;
