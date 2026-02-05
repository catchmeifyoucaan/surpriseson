---
summary: "Bug Hunter Stack: end-to-end setup (agents, budgets, research, QMD, memory, Artemis)"
read_when:
  - You want the full bug-hunting stack in one guide
  - You want reproducible config + cron snippets
---

# Bug Hunter Stack (end‑to‑end)

This is the **one‑page setup** that chains all critical components together.

## 0) Install + init

```bash
curl -fsSL https://surprisebot.bot/install.sh | bash
surprisebot init --quickstart --profile-template bug-hunter
```

> `--profile-template bug-hunter` preloads the multi‑agent roster.

## 1) Workspace + state discipline

- Workspace (default): `~/surprisebot`
- State (default): `~/.surprisebot`

Never nest workspace inside the state dir.

## 2) Multi‑seat Codex CLI (optional but recommended)

If you have multiple Codex CLI seats, you can spread load via **fallback order**.

```bash
mkdir -p ~/.codex/seat{1..5}
# place a valid auth.json in each seat directory
```

Config example:

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "codex-cli-seat1/gpt-5.2-codex",
        fallbacks: [
          "codex-cli-seat2/gpt-5.2-codex",
          "codex-cli-seat3/gpt-5.2-codex",
          "codex-cli-seat4/gpt-5.2-codex",
          "codex-cli-seat5/gpt-5.2-codex"
        ]
      }
    }
  }
}
```

This uses **failover**, not round‑robin. If a seat errors or cools down, Surprisebot falls back.

## 3) Mission Control ledger

Enable task + activity ledger with rollups:

```json5
{
  missionControl: {
    ledgerDir: "/srv/surprisebot/memory/mission-control",
    incidents: { minSeverity: "medium", defaultPriority: "medium" },
    rollup: { enabled: true, keepDays: 7, intervalMinutes: 360 },
    maintenance: { enabled: true, intervalMinutes: 1440 }
  }
}
```

## 4) Budget enforcement

```json5
{
  budgets: {
    enabled: true,
    mode: "enforce",
    window: "24h",
    global: { maxRuns: 200, maxConcurrent: 6 },
    byJobType: {
      research: { maxRuns: 200, maxConcurrent: 6 }
    },
    byAgent: {
      "research-exposures": { maxRuns: 40 },
      "research-cves": { maxRuns: 40 }
    }
  }
}
```

## 5) Research pipeline + auto‑tasks

Output dir (defaults to workspace):

```json5
{ research: { outputDir: "/srv/surprisebot/research/outputs" } }
```

Auto‑task gating:

```json5
{
  missionControl: {
    incidents: {
      minSeverity: "medium",
      defaultPriority: "medium",
      requireEvidence: true,
      minEvidenceCount: 2
    }
  }
}
```

## 6) QMD search (local, no vectors by default)

```bash
surprisebot init --install-bun --install-qmd
qmd collection add memory ~/surprisebot/memory
qmd collection add docs ~/surprisebot/docs
qmd collection add research ~/surprisebot/research
qmd collection add recon ~/surprisebot/recon
```

Cron job (hourly index):

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

## 7) Memory search + graph (optional)

Memory search is configured under `agents.defaults.memorySearch` (remote or local embeddings).
Memory graph uses Neo4j and is optional; keep it **off** on low‑resource nodes.

See: [/concepts/memory](/concepts/memory)

## 8) ARTEMIS (advanced, disabled by default)

Only enable after capacity checks. Do **not** enable on small VPS.

```json5
{
  artemis: {
    enabled: true,
    stanford: { enabled: true },
    cert: { enabled: true }
  }
}
```

See: [/advanced/artemis](/advanced/artemis)

---

## Operational tips
- **Use budgets first**, then increase gradually.
- **Keep ARTEMIS off** unless you have spare RAM/CPU.
- **Run QMD without embeddings** unless you explicitly need vectors.
- **Mission Control** gives you a single source of truth for tasks and reports.
