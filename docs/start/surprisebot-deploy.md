---
summary: "Deploy checklist for the Surprisebot reference stack (paths, env, one-shot setup)."
read_when:
  - You need a minimal deploy checklist for Surprisebot
  - You're migrating the stack to a new machine
---
# Surprisebot deploy checklist

This is a **small, practical checklist** for standing up the Surprisebot
reference stack on a new host.

If you want the one‑shot command checklist with exact paths and shared skills
layout, see [Surprisebot deploy checklist](/start/surprisebot-deploy-checklist).

## Paths (expected defaults)

- **Gateway config:** `~/.surprisebot/surprisebot.json`
- **Gateway env:** `~/.surprisebot/.env`
- **Surprisebot workspace:** `~/surprisebot/surprisebot/`
- **Recon pipeline:** `~/surprisebot/surprisebot/recon/`
- **Research pipeline:** `~/surprisebot/surprisebot/research/`
- **Skills (workspace):** `~/surprisebot/surprisebot/skills/`
- **System skills (optional):** `~/.codex/skills/` (shared across agents)

## Required env (minimum)

Put these in `~/.surprisebot/.env` (or set as system env vars):

- `GEMINI_API_KEY` (comma‑separated for rotation is supported)
- `BRAVE_API_KEY` (for web search tool)
- `SERPER_API_KEY` (hybrid search)
- `SERPAPI_API_KEY` (hybrid search)
- `PPLX_API_KEY` (Perplexity research agents)

Optional (only if you use them):

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GROQ_API_KEY`

If you use a local Neo4j memory graph, keep:

- `MEMORY_GRAPH_PASSWORD` (matches `agents.defaults.memoryGraph.password`)

## One‑shot setup

1) **Install Surprisebot**
   ```bash
   npm install -g surprisebot@latest
   ```

2) **Copy config + env**
   - Copy `~/.surprisebot/surprisebot.json` and `~/.surprisebot/.env` from your main host.

3) **Copy Surprisebot workspace**
   ```bash
   rsync -av ~/surprisebot/surprisebot/ <new-host>:~/surprisebot/surprisebot/
   ```

4) **Install skills (if used)**
   - Workspace skills live under `~/surprisebot/surprisebot/skills/`
   - System skills (optional): `~/.codex/skills/`

5) **Start the gateway**
   ```bash
   surprisebot gateway --verbose
   ```

6) **Validate**
   ```bash
   surprisebot status --all
   surprisebot models status
   ```

## Quick smoke checks

- Send a test message to your main channel.
- Run `/status` and `/whoami` from your chat surface.
- Run one research cron job:
  ```bash
  surprisebot cron list
  surprisebot cron run <job-id> --force
  ```

## Notes

- If you rotate multiple API keys, keep them **comma‑separated** in the env var.
- Prefer Tailscale/VPN for Gateway access if exposing the Control UI.
