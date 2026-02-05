# ARTEMIS Integration Blueprint (Surprisebot Control Plane)

## Goals
- Preserve **100%** of Stanford ARTEMIS capability (dynamic prompts, arbitrary sub‑agents, triage).
- Make ARTEMIS a **first‑class subsystem** of Surprisebot (schedule, budget, memory, alerts).
- Add CERT Artemis as a **breadth engine** feeding Surprisebot tasks.
- Keep Surprisebot as the **control plane** and ARTEMIS as the **execution plane**.

## Architecture

### Control Plane (Surprisebot)
- **Scheduler**: starts ARTEMIS runs on interval (or event triggers).
- **Budget enforcement**: global/agent/job budgets gate runs.
- **Policy**: scope + high‑signal gating + QA routing.
- **Run ledger + status**: durable evidence of what ran and when.

### Execution Plane (ARTEMIS)
- **Stanford ARTEMIS** runs as‑is with prompt generation and sub‑agent swarm.
- **CERT Artemis** runs as a batch scanner that emits JSON/JSONL output.

### Data Plane (Shared)
- Stanford ARTEMIS submissions → Surprisebot `research/outputs/*.jsonl`.
- CERT Artemis outputs → ingestion adapter → `research/outputs/*.jsonl`.
- Surprisebot incident pipeline converts outputs into **incidents → tasks**.

## IPC + Artifacts
- **IPC**: file‑based JSONL outputs + status files + run ledger.
- **Artifacts sync**: `supervisor.log`, `supervisor_todo.json`, notes copied into
  `workspace/research/artemis/sessions/<runId>/` and indexed in mission‑control documents.

## Budgets + QA Gating
- **Job types**: `artemis-stanford`, `artemis-cert`.
- **Budget enforcement**: uses Surprisebot budget manager before dispatch.
- **QA gating**: Surprisebot’s mission‑control rules enforce trust tiers and minimum evidence
  before tasks reach human‑visible channels.

## Phased Implementation

### Phase 1 — Control Plane (done)
- Config schema: `artemis.stanford` + `artemis.cert`.
- Runner with schedule + status + run ledger.
- CLI wrappers for `surprisebot artemis stanford:run` and `cert:ingest`.

### Phase 2 — Memory Sync (done)
- Sync ARTEMIS session artifacts into workspace.
- Add mission‑control document records for artifacts.

### Phase 3 — QA / Validation (next)
- Add per‑source QA thresholds for ARTEMIS outputs.
- Auto‑route high‑impact findings to QA agent before alerts.

### Phase 4 — CERT Artemis Native Runner (next)
- Integrate CERT Artemis service run + pipeline status tracking (instead of ingest‑only).

### Phase 5 — Metrics + Feedback (next)
- Run‑level metrics (false‑positive rate, validated rate, time‑to‑triage).
- Automated prompt tuning based on validated outcomes.

## Config Summary (example)
```json5
{
  artemis: {
    enabled: true,
    stanford: {
      enabled: true,
      intervalMinutes: 1440,
      configPath: "/home/kali/ARTEMIS/configs/stanford/level1.yaml",
      outputDir: "/srv/surprisebot/research/outputs",
      durationMinutes: 120,
      benchmarkMode: true,
      usePromptGeneration: true,
      jobType: "artemis-stanford",
      syncArtifacts: true
    },
    cert: {
      enabled: false,
      intervalMinutes: 1440,
      inputPath: "/data/cert-artemis/output",
      outputDir: "/srv/surprisebot/research/outputs",
      source: "artemis-cert",
      jobType: "artemis-cert"
    }
  }
}
```

## Notes
- ARTEMIS remains **unchanged in core behavior**; Surprisebot controls scheduling and budgets.
- ARTEMIS triage is preserved; Surprisebot adds a second QA pass for noise control.
