# Orchestrator v2 + Recon/Mem Contracts (Design)

This document maps the current Surprisebot architecture to concrete refactors.
It focuses on recon lifecycle, incident generation, and orchestrator routing.

## Scope
- Agents: `src/agents/*`
- Infra: `src/infra/*`
- Memory: `src/memory/*`
- Recon: `/srv/surprisebot/recon/*`

## Current Architecture (Verified)
- **Agent runs** use CLI backends with tool injection + bootstrap context files.
  - `src/agents/cli-runner.ts`
  - `src/agents/cli-runner/helpers.ts`
- **Tools** are assembled from core + plugins; memory tools are optional based on config.
  - `src/agents/surprisebot-tools.ts`
  - `src/agents/system-prompt.ts`
- **Subagents** persist run state, resume on restart, and announce completion.
  - `src/agents/subagent-registry.ts`
- **Shared memory** is a symlinked global file + pending file with write policies.
  - `src/agents/shared-memory.ts`
- **Incidents** are file watcher + poller with JSONL output and heartbeat wake.
  - `src/infra/incidents.ts`
- **Orchestrator** is a tick emitter (hourly/daily) that only enqueues system events.
  - `src/infra/orchestrator-runner.ts`
- **Recon status** is verified (PID + log) and used to gate status claims.
  - `src/infra/recon-status.ts`
- **Memory search** is SQLite + chokidar watch + interval sync.
  - `src/memory/manager.ts`, `src/memory/sqlite.ts`
- **Memory graph** is Neo4j with full reindex on sync.
  - `src/memory/graph-manager.ts`
- **Recon pipeline** is bash, outputs per-target files and run logs.
  - `/srv/surprisebot/recon/run.sh`

## Pain Points (Verified)
1) Recon pipeline docs list outputs that are not produced.
   - `recon/pipeline.md` vs `recon/run.sh`
2) Recon lifecycle is not formally closed in `status.json`.
   - `recon/launch.sh` writes status, `run.sh` never closes it.
3) Incident generator does not watch `status.json`.
4) Orchestrator does not dispatch incidents; only emits ticks.
5) Memory indexing uses SQLite without WAL/busy timeout.
6) Memory graph does full delete/rebuild each sync.

## Phase 1 (This Change Set)
### Goals
- Make recon status authoritative (start + finish + exit code).
- Ensure incident pipeline observes recon status changes.

### Exact refactors
1) `recon/launch.sh`
   - Add `runId` and pass status/log/start info to `run.sh` via env.
2) `recon/run.sh`
   - Write final `status.json` on exit:
     - `running: false`
     - `finishedAt`, `exitCode`
     - preserve `runId`, `startedAt`, `logPath`
3) `src/infra/recon-status.ts`
   - Extend `ReconStatus` to include `runId`, `finishedAt`, `exitCode`.
   - Preserve these fields in refresh + verification paths.
4) `src/infra/incidents.ts`
   - Watch `recon/status.json`.
   - Emit an incident on meaningful status change, with dedupe via a status signature.

### Recon status JSON schema (after Phase 1)
```json
{
  "running": true,
  "pid": 12345,
  "logPath": "/srv/surprisebot/recon/runs/2026-02-03.log",
  "startedAt": "2026-02-03T03:14:11Z",
  "runId": "recon-2026-02-03-031411-41235",
  "finishedAt": "2026-02-03T03:42:09Z",
  "exitCode": 0
}
```

## Phase 2 (Next)
- Orchestrator v2 queue + dispatcher:
  - `src/infra/orchestrator/{runner,queue,dispatcher}.ts`
  - Route incidents to specialist agents via config rules.

## Phase 3 (Next)
- Memory index reliability:
  - SQLite WAL, busy_timeout, transaction batching.
- Memory graph incremental updates:
  - Upsert by `(workspaceId,id)`, delete stale only.

## Implementation Order
1) Recon status lifecycle + incident watch. (Phase 1)
2) Orchestrator dispatch pipeline. (Phase 2)
3) Memory index WAL + retries. (Phase 3)
4) Recon output parity with docs. (Phase 3+)
