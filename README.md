# Agent Memory

Cloudflare clone of [Agent Memory](https://developers.cloudflare.com/agent-memory/): Hono Worker, one SQLite Durable Object per profile, Luna extract/recall, FTS + topic-key search.

Vectorize is not wired yet. Slice 3.

## Stack

- HTTP = [Hono](https://hono.dev)
- Profile = `MemoryProfile` Durable Object (`namespace:profile`)
- Source of truth = SQLite + FTS5
- Extract / classify / query analysis / synthesis = `openai/gpt-5.6-luna` via OpenRouter
- `reasoning.effort` is always `none`
- Package manager = Bun

## Setup

```bash
bun install
cp .dev.vars.example .dev.vars
# put OPENROUTER_API_KEY in .dev.vars
bun run types
bun run dev
```

## API

All routes are scoped:

```
/namespaces/:namespace/profiles/:profile/...
```

```bash
# remember one fact
curl -s localhost:8787/namespaces/demo/profiles/alice/remember \
  -H 'content-type: application/json' \
  -d '{"content":"I prefer TypeScript and concise answers.","sessionId":"chat-1"}'

# ingest a conversation (idle-batch this in the agent, not every turn)
curl -s localhost:8787/namespaces/demo/profiles/alice/ingest \
  -H 'content-type: application/json' \
  -d '{"sessionId":"chat-1","messages":[
    {"role":"user","content":"Use pnpm, not npm."},
    {"role":"assistant","content":"Got it — pnpm from now on."}
  ]}'

# wait a few seconds, then recall from a different session
curl -s localhost:8787/namespaces/demo/profiles/alice/recall \
  -H 'content-type: application/json' \
  -d '{"query":"package manager preference","responseLength":"short"}'

# inspect
curl -s localhost:8787/namespaces/demo/profiles/alice/summary -X POST -d '{}'
curl -s localhost:8787/namespaces/demo/profiles/alice/memories
```

`ingest` is idempotent. Same `sessionId + role + content` does not duplicate.

## Cost (1k users, 20 chats)

Luna ~$40. Cloudflare floor $5. DOs $0. Embeddings later, cents.
