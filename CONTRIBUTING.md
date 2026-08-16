# Contributing

Thanks for helping with Agent Memory. Contributions are licensed under the
[MIT License](LICENSE). Copyright remains with THISUX Private Limited.

Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Stack

- Cloudflare Worker + Hono
- One SQLite Durable Object per `namespace:profile`
- OpenRouter `openai/gpt-5.6-luna` for extract / classify / recall
- Package manager: **Bun only**

Read [AGENTS.md](AGENTS.md) before changing architecture.

## Setup

```bash
bun install
cp .dev.vars.example .dev.vars
# set OPENROUTER_API_KEY and MEMORY_API_TOKEN
bun run types
bun run check
bun run test
bun run dev
```

Do not commit `.dev.vars`. Do not add `package-lock.json`, `yarn.lock`, or `pnpm-lock.yaml`.

## How to change things

1. Open an issue first for architecture changes (ingest pipeline, recall channels, Vectorize).
2. Keep isolation: Alice's profile must never see Bob.
3. `ingest` stays content-addressed and idempotent.
4. Luna calls must keep `reasoning.effort: "none"`.
5. Durable Objects must not call OpenRouter, Workers AI, or Vectorize. Keep LLM/embed work in the Worker / queue consumer.
6. Prefer `POST .../queue` for chat traffic. Use `POST .../ingest` only for an explicit flush.
7. Run `bun run check` and `bun run test` before opening a PR.
8. After `wrangler.jsonc` changes, run `bun run types`. Secrets stay in `src/env.d.ts`.

## Pull requests

- One concern per PR.
- Use the PR template.
- Describe the user-visible change, not just the files.
- Include a curl repro for API changes.

## Security

Do not file public issues for vulnerabilities. Email `hello@thisux.com` as described in [SECURITY.md](SECURITY.md).
