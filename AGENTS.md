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
bunx wrangler types
bunx wrangler deploy
```

Lockfile is `bun.lock`. Do not create `package-lock.json` or `yarn.lock`.

## Architecture

```
Hono Worker  ──RPC──►  MemoryProfile DO (SQLite + FTS5)
                          extract / classify / recall via OpenRouter Luna
```

- Isolation: `namespace:profile` → one Durable Object. Alice never sees Bob.
- Source of truth: SQLite. Vectorize is not wired (Slice 3).
- LLM: `openai/gpt-5.6-luna`, `reasoning.effort: "none"`. Always.
- Ingest after idle / compaction. Never after every turn.

## Commands

```bash
bun install
cp .dev.vars.example .dev.vars   # set OPENROUTER_API_KEY
bunx wrangler types
bun run check
bun run dev
```

## API

```
GET    /health
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

`ingest` is content-addressed. Same session + role + content does not duplicate.

## Files

| Path | Role |
|---|---|
| `src/index.ts` | Hono HTTP API |
| `src/profile.ts` | Durable Object: SQL, supersession, search |
| `src/luna.ts` | OpenRouter client |
| `src/ids.ts` | Content hashes, topic keys |
| `src/validate.ts` | Request limits |
| `src/types.ts` | Shared types |
| `wrangler.jsonc` | Worker + DO bindings |

## Do not

- Call Luna with reasoning left on
- Ingest every agent turn
- Share one DO across profiles
- Hand-write `Env` for bindings — run `bunx wrangler types`. Secrets go in `src/env.d.ts`
- Add Vectorize until Slice 3
