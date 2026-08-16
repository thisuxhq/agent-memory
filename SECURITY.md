# Security policy

## Supported versions

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Latest GitHub Release | Yes |
| Older tags | No |

## Reporting a vulnerability

Email **hello@thisux.com** with subject `[security] agent-memory`.

Include:

- Affected commit or release
- Impact (memory leak across profiles, secret exposure, prompt injection into stored facts)
- Steps to reproduce

Do **not** open a public GitHub issue for security-sensitive findings.

We aim to acknowledge reports within 5 business days. Please give us a reasonable window to ship a fix before any public disclosure.

## Secrets

Never commit `.dev.vars`, OpenRouter keys, or Cloudflare API tokens. Use Wrangler secrets in production:

```bash
bunx wrangler secret put OPENROUTER_API_KEY
bunx wrangler secret put MEMORY_API_TOKEN
```
