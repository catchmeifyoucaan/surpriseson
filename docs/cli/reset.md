---
summary: "CLI reference for `surprisebot reset` (reset local state/config)"
read_when:
  - You want to wipe local state while keeping the CLI installed
  - You want a dry-run of what would be removed
---

# `surprisebot reset`

Reset local config/state (keeps the CLI installed).

```bash
surprisebot reset
surprisebot reset --dry-run
surprisebot reset --scope config+creds+sessions --yes --non-interactive
```

