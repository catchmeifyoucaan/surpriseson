---
summary: "Minimal install: CLI + gateway only (no Docker, no Neo4j, no QMD)"
read_when:
  - You want the smallest possible Surprisebot install
  - You don't need Docker, Neo4j, or local search yet
---

# Minimal mode (CLI-only)

This path keeps Surprisebot lightweight: CLI + Gateway only.

## 1) Install


If you prefer the installer:

```bash
curl -fsSL https://surprisebot.bot/install.sh | bash -s -- --minimal
```
```bash
npm install -g surprisebot@latest
# or
pnpm add -g surprisebot@latest
```

## 2) Bootstrap without extras

```bash
surprisebot init --minimal
```

If you want onboarding with more options, run:

```bash
surprisebot init --quickstart
```

## 3) Run the gateway

```bash
surprisebot gateway --port 18789
```

## Not included

Minimal mode keeps Surprisebot light. These features are **off by default**:
- Mission Control (task ledger + reports)
- Budgets + incident/task pipeline
- Research automation + output ingestion
- ARTEMIS integration
- QMD indexing
- Neo4j memory graph


## 4) Optional services (later)

- Docker: install only if you need containerized tools.
- Neo4j: only needed for graph memory.
- QMD: optional local document search.

When ready:

```bash
surprisebot init --install-bun --install-qmd
surprisebot install-service
```
