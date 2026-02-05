---
summary: "CLI reference for `surprisebot agents` (list/add/delete isolated agents)"
read_when:
  - You want multiple isolated agents (workspaces + routing + auth)
---

# `surprisebot agents`

Manage isolated agents (workspaces + auth + routing).

Related:
- Multi-agent routing: [Multi-Agent Routing](/concepts/multi-agent)
- Agent workspace: [Agent workspace](/concepts/agent-workspace)

## Examples

```bash
surprisebot agents list
surprisebot agents add work --workspace ~/surprisebot-work
surprisebot agents delete work
```

