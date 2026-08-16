# Agent Memory

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Copyright](https://img.shields.io/badge/©-THISUX%20Private%20Limited-111111.svg)](LICENSE)

Scoped memory for agents on Cloudflare. Store facts. Recall later. Alice never sees Bob.

Inspired by [Cloudflare Agent Memory](https://developers.cloudflare.com/agent-memory/).

---

## Deploy (1 click)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/thisuxhq/agent-memory)

Secrets the wizard asks for:

| Secret | Value |
| --- | --- |
| `OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) |
| `MEMORY_API_TOKEN` | `openssl rand -hex 32` |

Then hit `/health`. Done.

---

## Try it

```bash
BASE=https://YOUR_WORKER.workers.dev
AUTH="authorization: Bearer $MEMORY_API_TOKEN"
CT="content-type: application/json"
P="$BASE/namespaces/demo/profiles/alice"

curl -s "$P/remember" -H "$AUTH" -H "$CT" \
  -d '{"content":"I prefer Bun and short answers.","sessionId":"s1"}'

curl -s "$P/recall" -H "$AUTH" -H "$CT" \
  -d '{"query":"package manager","responseLength":"short"}'
```

Local instead:

```bash
bun install
cp .dev.vars.example .dev.vars   # fill the two secrets
bun run dev
# use BASE=http://localhost:8787
```

---

## API

Every profile route needs:

```http
Authorization: Bearer $MEMORY_API_TOKEN
```

`/health` is open.

```
/namespaces/:ns/profiles/:profile/...
```

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/remember` | Store one fact now |
| `POST` | `/queue` | Write chat, extract after ~10s idle |
| `POST` | `/ingest` | Write chat + extract now |
| `POST` | `/recall` | Search + grounded answer (or empty) |
| `POST` | `/summary` | Markdown dump of the profile |
| `GET` | `/memories` | List stored memories |
| `DELETE` | `/memories/:id` | Forget one |
| `DELETE` | `/sessions/:id` | Forget a session |
| `DELETE` | `/` (profile) | Wipe profile |

Same message twice does not duplicate.

---

## How it works

```
You  →  Hono Worker (auth + Luna + embeddings)
              │
              ├─ MemoryProfile DO  →  SQLite + FTS  (source of truth)
              ├─ Queue             →  idle extract
              └─ Vectorize         →  semantic + HyDE search
```

1. One Durable Object per `namespace:profile`
2. Idle DOs hibernate → ~$0 when unused
3. Extract turns chat into fact / event / instruction / task
4. Recall fuses topic key + FTS + vectors + HyDE, then answers from hits only

---

## Cost (1k users, 20 chats/mo)

| Line | ~$ |
| --- | --- |
| Luna (OpenRouter) | $40–60 |
| Cloudflare floor | $5 |
| DOs / Vectorize / embeds | ~$0–1 |
| **Total** | **~$45–65** |

Bill = Luna calls. Not object count.

---

## Stack

- [Hono](https://hono.dev) + Workers + SQLite Durable Objects
- OpenRouter `openai/gpt-5.6-luna` (`reasoning: none`)
- Workers AI `bge-m3` + Vectorize
- Bun

More: [AGENTS.md](AGENTS.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## License

Copyright © 2026 [THISUX Private Limited](https://github.com/thisuxhq). [MIT](LICENSE).
