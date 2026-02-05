# Memory Indexing Contract

This document defines memory search indexing behavior and reliability guarantees.

## Storage
- SQLite database per agent (default: `$STATE_DIR/memory/{agentId}.sqlite`).

## Reliability Settings
Applied on database open:
- `PRAGMA journal_mode=WAL;`
- `PRAGMA synchronous=NORMAL;`
- `PRAGMA busy_timeout=5000;`

## Sync Behavior
- Chokidar watch marks dirty on changes to `MEMORY.md` + `memory/*.md`.
- Lazy sync on search when dirty.
- Optional periodic sync via `sync.intervalMinutes`.

## Write Safety
- Per-file indexing runs inside a single transaction.
- Deletes + inserts for a file are committed atomically.

## Embeddings
- Remote embeddings use retry/backoff for transient failures (429/5xx/timeout).
- Empty chunks are skipped to avoid provider errors.

## Failure Modes
- If embeddings fail, index remains at last consistent state.
- WAL + busy_timeout reduce lock contention from concurrent access.
