# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Bearer auth on all `/namespaces/*` routes via `MEMORY_API_TOKEN`
- `POST .../queue` idle-batch path: write messages, extract after 10s alarm + queue
- Worker-side Luna orchestration so Durable Objects stay SQL-only
- Vitest pool-workers coverage for auth, isolation, supersession, and idempotent writes

### Changed

- `POST .../ingest` remains the immediate flush path; chat traffic should use `/queue`

## [0.1.0] - 2026-08-16

### Added

- Hono Worker API for `ingest`, `remember`, `recall`, `list`, `get`, `delete`, and `summary`
- One SQLite Durable Object per `namespace:profile` with FTS5 and fact/instruction supersession
- OpenRouter Luna extract, classify, query analysis, and synthesis (`reasoning.effort: none`)
- Content-addressed, idempotent conversation ingest
- THISUX community health files and MIT license

[0.1.0]: https://github.com/thisuxhq/agent-memory/releases/tag/v0.1.0
