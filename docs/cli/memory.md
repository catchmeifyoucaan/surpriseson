---
summary: "CLI reference for `surprisebot memory` (status/index/search)"
read_when:
  - You want to index or search semantic memory
  - You’re debugging memory availability or indexing
---

# `surprisebot memory`

Memory search tools (semantic memory status/index/search).

Related:
- Memory concept: [Memory](/concepts/memory)

## Options

These flags override the configured memory sync behavior for a single CLI run:

- `--no-watch`: disable file watcher sync.
- `--no-interval`: disable interval sync.
- `--no-watch-interval`: disable watcher + interval sync.

## Examples

```bash
surprisebot memory status
surprisebot memory index
surprisebot memory search "release checklist"
surprisebot memory status --no-watch-interval
```
