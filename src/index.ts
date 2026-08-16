import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { MemoryProfile } from "./profile";
import { requireBearer } from "./auth";
import {
  deleteSessionNow,
  destroyProfileNow,
  ingestNow,
  processExtractJob,
  profileStub,
  queueIngest,
  recallNow,
  rememberNow,
  requireDeleteMemory,
  requireMemory,
} from "./service";
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

app.use("/namespaces/*", async (c, next) => {
  requireBearer(c.req.header("Authorization"), c.env.MEMORY_API_TOKEN);
  await next();
});

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
  await destroyProfileNow(c.env, c.req.param("namespace"), c.req.param("profile"));
  return c.json({ ok: true });
});

profiles.post("/:namespace/profiles/:profile/ingest", async (c) => {
  const body = await readJson(c);
  const result = await ingestNow(
    c.env,
    c.req.param("namespace"),
    c.req.param("profile"),
    requireMessages(body.messages),
    requireSessionId(typeof body.sessionId === "string" ? body.sessionId : null),
  );
  return c.json(result);
});

profiles.post("/:namespace/profiles/:profile/queue", async (c) => {
  const body = await readJson(c);
  const result = await queueIngest(
    c.env,
    c.req.param("namespace"),
    c.req.param("profile"),
    requireMessages(body.messages),
    {
      sessionId: requireSessionId(typeof body.sessionId === "string" ? body.sessionId : null),
      delaySeconds: typeof body.delaySeconds === "number" ? body.delaySeconds : 10,
    },
  );
  return c.json(result);
});

profiles.post("/:namespace/profiles/:profile/remember", async (c) => {
  const body = await readJson(c);
  const stored = await rememberNow(
    c.env,
    c.req.param("namespace"),
    c.req.param("profile"),
    requireContent(body.content),
    requireSessionId(typeof body.sessionId === "string" ? body.sessionId : null),
  );
  return c.json(stored);
});

profiles.post("/:namespace/profiles/:profile/recall", async (c) => {
  const body = await readJson(c);
  const result = await recallNow(
    c.env,
    c.req.param("namespace"),
    c.req.param("profile"),
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
  const result = await profileStub(c.env, c.req.param("namespace"), c.req.param("profile")).summary({
    sessionId: requireSessionId(typeof body.sessionId === "string" ? body.sessionId : null),
  });
  return c.json(result);
});

profiles.get("/:namespace/profiles/:profile/memories", async (c) => {
  const result = await profileStub(c.env, c.req.param("namespace"), c.req.param("profile")).list({
    limit: parseLimit(c.req.query("limit") ?? null),
    cursor: c.req.query("cursor"),
    sessionId: c.req.query("sessionId"),
    type: requireMemoryType(c.req.query("type")),
  });
  return c.json(result);
});

profiles.get("/:namespace/profiles/:profile/memories/:memoryId", async (c) => {
  return c.json(
    await requireMemory(
      c.env,
      c.req.param("namespace"),
      c.req.param("profile"),
      c.req.param("memoryId"),
    ),
  );
});

profiles.delete("/:namespace/profiles/:profile/memories/:memoryId", async (c) => {
  return c.json(
    await requireDeleteMemory(
      c.env,
      c.req.param("namespace"),
      c.req.param("profile"),
      c.req.param("memoryId"),
    ),
  );
});

profiles.delete("/:namespace/profiles/:profile/sessions/:sessionId", async (c) => {
  const sessionId = requireSessionId(c.req.param("sessionId")) ?? c.req.param("sessionId");
  await deleteSessionNow(c.env, c.req.param("namespace"), c.req.param("profile"), sessionId);
  return c.json({ ok: true });
});

app.route("/namespaces", profiles);

export default {
  fetch: app.fetch,
  async queue(batch, env): Promise<void> {
    for (const message of batch.messages) {
      await processExtractJob(env, message.body.namespace, message.body.profile);
    }
  },
} satisfies ExportedHandler<Env, ExtractJob>;
