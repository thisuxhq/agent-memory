# Agent Memory

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Copyright](https://img.shields.io/badge/©-THISUX%20Private%20Limited-111111.svg)](LICENSE)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thisuxhq/agent-memory)

Persistent, scoped memory for agents on Cloudflare Workers. One SQLite Durable Object per profile. Conversations become facts, events, instructions, and tasks. Recall returns a grounded answer, or nothing.

Inspired by [Cloudflare Agent Memory](https://developers.cloudflare.com/agent-memory/).

## Why this exists

[Cloudflare Agent Memory](https://developers.cloudflare.com/agent-memory/) is still in private beta. I needed profiles, extract, recall, and isolation now, and I wanted to tweak it without leaving Cloudflare.

So I built it on Workers, Durable Objects, Queues, Workers AI, and Vectorize. Same idea. Your knobs. No waitlist. No extra database outside the ecosystem.

Need this on your own VM instead? I'm already working on that.

## One-click deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thisuxhq/agent-memory)

That button clones this repo into your GitHub/GitLab account, provisions Durable Objects, Queues, Workers AI, and Vectorize from `wrangler.jsonc`, then deploys.

You will be asked for two secrets (from [`.dev.vars.example`](.dev.vars.example)):

| Secret | What to paste |
| --- | --- |
| `OPENROUTER_API_KEY` | Key from [openrouter.ai/keys](https://openrouter.ai/keys) |
| `MEMORY_API_TOKEN` | Any long random string (`openssl rand -hex 32`) |

After deploy, call `/health`, then hit `/namespaces/:ns/profiles/:profile/...` with `Authorization: Bearer $MEMORY_API_TOKEN`.

## Stack

- HTTP = [Hono](https://hono.dev)
- Profile = `MemoryProfile` Durable Object (`namespace:profile`), SQL only
- Worker = auth, Luna extract/classify/recall, embeddings, queue consumer
- Source of truth = SQLite + FTS5
- Semantic recall = Workers AI `bge-m3` + Vectorize (`agent-memory`), including HyDE
- Extract / classify / query analysis / synthesis = `openai/gpt-5.6-luna` via OpenRouter
- `reasoning.effort` is always `none`
- Package manager = Bun

## Setup

```bash
bun install
cp .dev.vars.example .dev.vars
# put OPENROUTER_API_KEY and MEMORY_API_TOKEN in .dev.vars
bun run types
bun run test
bun run dev
```

## API

All profile routes need:

```
Authorization: Bearer $MEMORY_API_TOKEN
```

`/health` is public.

```
/namespaces/:namespace/profiles/:profile/...
```

```bash
TOKEN=dev-token

# remember one fact (sync)
curl -s localhost:8787/namespaces/demo/profiles/alice/remember \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"content":"I prefer TypeScript and concise answers.","sessionId":"chat-1"}'

# queue messages (idle-batch extract in ~10s)
curl -s localhost:8787/namespaces/demo/profiles/alice/queue \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"sessionId":"chat-1","messages":[
    {"role":"user","content":"Use pnpm, not npm."},
    {"role":"assistant","content":"Got it. pnpm from now on."}
  ]}'

# or flush now
curl -s localhost:8787/namespaces/demo/profiles/alice/ingest \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"sessionId":"chat-1","messages":[
    {"role":"user","content":"Use pnpm, not npm."},
    {"role":"assistant","content":"Got it. pnpm from now on."}
  ]}'

# recall
curl -s localhost:8787/namespaces/demo/profiles/alice/recall \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"query":"package manager preference","responseLength":"short"}'

# inspect
curl -s localhost:8787/namespaces/demo/profiles/alice/summary \
  -H "authorization: Bearer $TOKEN" -X POST -d '{}'
curl -s localhost:8787/namespaces/demo/profiles/alice/memories \
  -H "authorization: Bearer $TOKEN"
```

`ingest` / `queue` are idempotent. Same `sessionId + role + content` does not duplicate.

| Route | Behavior |
| --- | --- |
| `POST .../queue` | Write messages, extract after 10s idle (resets on each call) |
| `POST .../ingest` | Write + extract now |
| `POST .../remember` | Classify + store one memory now |
| `POST .../recall` | Hybrid search + synthesized answer |

## Deploy

### One-click

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thisuxhq/agent-memory)

### CLI

```bash
bunx wrangler secret put OPENROUTER_API_KEY
bunx wrangler secret put MEMORY_API_TOKEN
bun run deploy
```

One-click provision creates the Vectorize index and queue from `wrangler.jsonc`. Manual CLI deploy needs those resources to exist first (or let Wrangler create them when prompted).

## Cost (1k users, 20 chats)

Luna ~$40. Cloudflare floor $5. DOs $0. Embeddings + Vectorize ~cents.

## Docs

- [Contributing](CONTRIBUTING.md)
- [Security](SECURITY.md)
- [Changelog](CHANGELOG.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Agent notes](AGENTS.md)

## License

Copyright © 2026 [THISUX Private Limited](https://github.com/thisuxhq).

Released under the [MIT License](LICENSE). You may use, modify, and distribute this project for personal and commercial purposes, provided the copyright and permission notice are retained.
