---
summary: "Budget enforcement: cap runs, tokens, and concurrency"
read_when:
  - You want to prevent runaway costs or job floods
  - You’re enabling scheduled research and heavy tools
---

# Budgets

Surprisebot supports **budget enforcement** to cap runs, tokens, and concurrency for heavy workflows.
Budgets are enforced **before dispatch** and recorded in the Mission Control budget ledger.

## Where budgets live

```json
{
  "budgets": {
    "enabled": true,
    "mode": "enforce",
    "window": "24h",
    "global": { "maxRuns": 200, "maxConcurrent": 6 },
    "byAgent": {
      "research-exposures": { "maxRuns": 40 },
      "research-cves": { "maxRuns": 40 }
    },
    "byJobType": {
      "research": { "maxRuns": 200, "maxConcurrent": 6 }
    }
  }
}
```

### Fields
- `enabled`: turn budgets on/off
- `mode`: `enforce` (block) or `warn` (log only)
- `window`: rolling duration (`1h`, `24h`, `7d`)
- `global`: caps across all agents
- `byAgent`: per‑agent caps
- `byJobType`: caps per routed job type

## Enforcement order
1. `global`
2. `byJobType`
3. `byAgent`

If any budget fails and `mode=enforce`, the dispatch is blocked and a budget‑ledger entry is written.

## Ledger
Budget checks are recorded in:

```
~/.surprisebot/memory/mission-control/budget-ledger.jsonl
```

## Recommended defaults
- Start with `mode: "warn"` for a week
- Then move to `mode: "enforce"`
- Keep `maxConcurrent` low on small VPS nodes
