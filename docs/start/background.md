---
summary: "What runs in the background (Gateway, cron, tools)"
read_when:
  - You want to understand running processes/services
  - You need to audit resource usage
---

# What runs in the background

Surprisebot runs a few components depending on your setup:

## Core
- **Gateway service** (always): handles sessions, tools, and channels.
- **Cron jobs** (optional): scheduled agents, heartbeats, maintenance, research.
- **Mission Control**: task ledger + reports (JSONL).
- **Budgets**: cap runs/tokens/concurrency before dispatch.
- **Research pipeline**: outputs → incidents → tasks.

## Optional (only if enabled)
- **QMD**: local doc search indexer.
- **Neo4j**: memory graph backend.
- **ARTEMIS**: advanced scanner integration (disabled by default).
- **Docker**: containerized tools + sandbox images.
- **Artemis**: heavy scanners (disable on low-resource hosts).

## Where to check
- Service status: `surprisebot status` or `surprisebot gateway status`
- Logs: `journalctl -u surprisebot-gateway.service -f` (systemd)
- Cron jobs: `surprisebot cron list`

## Recommended defaults
- Low-resource hosts: avoid Docker/Neo4j/Artemis.
- Enable only what you need; add more later.
