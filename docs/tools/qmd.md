---
summary: "QMD: local document search + indexing"
read_when:
  - You want fast local recall across docs and memory
  - You’re enabling research/knowledge workflows
---

# QMD

QMD is a **local Markdown indexer** for fast search. It’s lightweight and does **not** require remote embeddings by default.

## Install

```bash
surprisebot init --install-bun --install-qmd
```

Or manually:

```bash
bun install -g https://github.com/tobi/qmd
```

## Collections

Recommended collections:
- `memory` → `~/surprisebot/memory/`
- `docs` → `~/surprisebot/docs/`
- `research` → `~/surprisebot/research/`
- `recon` → `~/surprisebot/recon/`

Example:

```bash
qmd collection add memory ~/surprisebot/memory
qmd collection add docs ~/surprisebot/docs
```

## Scheduled indexing

Use cron to refresh indexes:

```json
{
  "name": "qmd-hourly",
  "cron": "0 * * * *",
  "job": {
    "kind": "agentTurn",
    "agentId": "surprisebot-ops",
    "message": "Run: qmd index memory docs research recon"
  }
}
```

## Search

```bash
qmd search memory "oauth" --limit 10
```

## Health probe

Add a heartbeat check (recommended) to alert if QMD fails.
