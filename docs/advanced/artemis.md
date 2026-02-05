---
summary: "ARTEMIS integration (capacity, safety, and orchestration)"
read_when:
  - You want full-scale automated scanning
  - You need to coordinate ARTEMIS output with Mission Control
---

# ARTEMIS (Advanced)

Surprisebot can **integrate ARTEMIS** as a heavy‑duty scanner and ingest its output into the incident → task pipeline.

**Important:** ARTEMIS is **not enabled by default** and can easily overwhelm low‑resource systems.

## What ARTEMIS adds
- Large‑scale scanning + triage
- Structured output suitable for auto‑routing
- Long‑running parallel execution

## Why it’s disabled by default
- High RAM/CPU usage
- Spawns many processes/containers
- Requires careful rate limiting and budgets

## Recommended safeguards
- Budget enforcement (`budgets`)
- Low concurrency on small nodes
- Separate host if you have < 16 GB RAM

## Integration points
- Output → `research/outputs/*.jsonl`
- Incident generation → Mission Control tasks
- Optional QA gate before alerting

## Enable (only after capacity checks)

```json
{
  "artemis": {
    "enabled": true,
    "stanford": { "enabled": true },
    "cert": { "enabled": true }
  }
}
```

See also:
- CLI: [`surprisebot artemis`](/cli/artemis)
- Research pipeline: [/research/pipeline](/research/pipeline)
- Budgets: [/gateway/budgets](/gateway/budgets)
