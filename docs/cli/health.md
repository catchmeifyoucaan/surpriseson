---
summary: "CLI reference for `surprisebot health` (gateway health endpoint via RPC)"
read_when:
  - You want to quickly check the running Gateway’s health
---

# `surprisebot health`

Fetch health from the running Gateway.

```bash
surprisebot health
surprisebot health --json
```


## Preflight (local system check)

```bash
surprisebot health --preflight
surprisebot health --preflight --json
```

Use this before onboarding to validate RAM/disk/CPU on the local host.
