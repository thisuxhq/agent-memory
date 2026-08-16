# Agent instructions

This repo clones Cloudflare Agent Memory on Workers.

## Package manager

Always use **Bun**. Never npm, npx, yarn, or pnpm.

```bash
bun install
bun add <pkg>
bun add -d <pkg>
bun run dev
bun run check
bun run test
bunx wrangler types
bunx wrangler deploy
```

Lockfile is `bun.lock`. Do not create `package-lock.json` or `yarn.lock`.

## Architecture

```
Hono Worker  ──auth──►  Luna (OpenRouter)
     │                      │
     ├──RPC──► MemoryProfile DO (SQLite + FTS5 only)
     │
     └──queue──► extract consumer (Luna, then storeMemories)
```

- Isolation: `namespace:profile` → one Durable Object. Alice never sees Bob.
- Source of truth: SQLite. Vectorize is not wired (Slice 3).
- DO does not call OpenRouter. Worker + queue consumer do.
- LLM: `openai/gpt-5.6-luna`, `reasoning.effort: "none"`. Always.
- Prefer `POST .../queue` for chat traffic. Use `POST .../ingest` only for an explicit flush.

## Auth

All `/namespaces/*` routes require `Authorization: Bearer $MEMORY_API_TOKEN`.
`/health` is public.

## Commands

```bash
bun install
cp .dev.vars.example .dev.vars   # OPENROUTER_API_KEY + MEMORY_API_TOKEN
bunx wrangler types
bun run check
bun run test
bun run dev
```

## API

```
GET    /health
POST   /namespaces/:ns/profiles/:profile/queue
POST   /namespaces/:ns/profiles/:profile/ingest
POST   /namespaces/:ns/profiles/:profile/remember
POST   /namespaces/:ns/profiles/:profile/recall
POST   /namespaces/:ns/profiles/:profile/summary
GET    /namespaces/:ns/profiles/:profile/memories
GET    /namespaces/:ns/profiles/:profile/memories/:id
DELETE /namespaces/:ns/profiles/:profile/memories/:id
DELETE /namespaces/:ns/profiles/:profile/sessions/:sessionId
DELETE /namespaces/:ns/profiles/:profile
```

Messages are content-addressed. Same session + role + content does not duplicate.

## Files

| Path | Role |
|---|---|
| `src/index.ts` | Hono HTTP + queue consumer |
| `src/service.ts` | Orchestration (Luna + DO) |
| `src/profile.ts` | Durable Object: SQL only |
| `src/luna.ts` | OpenRouter client |
| `src/auth.ts` | Bearer token check |
| `src/ids.ts` | Content hashes, topic keys |
| `src/validate.ts` | Request limits |
| `test/` | Vitest pool-workers tests |

## Do not

- Call Luna with reasoning left on
- Call OpenRouter from the Durable Object
- Ingest every agent turn (use `/queue`)
- Share one DO across profiles
- Hand-write binding `Env` — run `bunx wrangler types`. Secrets stay in `src/env.d.ts`
- Add Vectorize until Slice 3
