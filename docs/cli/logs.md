---
summary: "CLI reference for `surprisebot logs` (tail gateway logs via RPC)"
read_when:
  - You need to tail Gateway logs remotely (without SSH)
  - You want JSON log lines for tooling
---

# `surprisebot logs`

Tail Gateway file logs over RPC (works in remote mode).

Related:
- Logging overview: [Logging](/logging)

## Examples

```bash
surprisebot logs
surprisebot logs --follow
surprisebot logs --json
surprisebot logs --limit 500
```

