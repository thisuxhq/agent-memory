## Summary

<!-- What changes for a caller of ingest / remember / recall? -->

## Type of change

- [ ] Bug fix
- [ ] API change
- [ ] Extraction / recall quality
- [ ] Docs / community health
- [ ] Other

## Checklist

- [ ] `bun run check` passes
- [ ] `bun run test` passes
- [ ] Isolation still holds (`namespace:profile` never crosses)
- [ ] Message writes stay idempotent if messages were touched
- [ ] Luna still uses `reasoning.effort: "none"`
- [ ] Durable Objects still do not call OpenRouter
- [ ] `.dev.vars` and secrets are not in the diff
- [ ] `bun run types` rerun if `wrangler.jsonc` changed
