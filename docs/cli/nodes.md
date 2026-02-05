---
summary: "CLI reference for `surprisebot nodes` (list/status/approve/invoke, camera/canvas/screen)"
read_when:
  - You’re managing paired nodes (cameras, screen, canvas)
  - You need to approve requests or invoke node commands
---

# `surprisebot nodes`

Manage paired nodes (devices) and invoke node capabilities.

Related:
- Nodes overview: [Nodes](/nodes)
- Camera: [Camera nodes](/nodes/camera)
- Images: [Image nodes](/nodes/images)

## Common commands

```bash
surprisebot nodes list
surprisebot nodes pending
surprisebot nodes approve <requestId>
surprisebot nodes status
```

## Invoke / run

```bash
surprisebot nodes invoke --node <id|name|ip> --command <command> --params <json>
surprisebot nodes run --node <id|name|ip> <command...>
```

