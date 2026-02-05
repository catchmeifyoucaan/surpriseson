---
summary: "CLI reference for `surprisebot agent` (send one agent turn via the Gateway)"
read_when:
  - You want to run one agent turn from scripts (optionally deliver reply)
---

# `surprisebot agent`

Run an agent turn via the Gateway (use `--local` for embedded).

Related:
- Agent send tool: [Agent send](/tools/agent-send)

## Examples

```bash
surprisebot agent --to +15555550123 --message "status update" --deliver
surprisebot agent --session-id 1234 --message "Summarize inbox" --thinking medium
```

