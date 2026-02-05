# Recon Contract

This document defines the recon inputs/outputs and status lifecycle.

## Inputs
- `/srv/surprisebot/recon/targets.txt`
- `/srv/surprisebot/recon/targets_catalog.csv` (optional)

## Execution
- Launch: `/srv/surprisebot/recon/launch.sh`
- Direct run: `/srv/surprisebot/recon/run.sh`

## Status Lifecycle
`/srv/surprisebot/recon/status.json`

- Written on launch with `running=true` + `pid` + `logPath` + `startedAt` + `runId`.
- Finalized on exit with `running=false` + `finishedAt` + `exitCode`.

Schema:
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

## Outputs (Per Target)
`/srv/surprisebot/recon/outputs/<target>/`

- `subdomains.txt`
- `live.txt`
- `live-meta.txt`
- `endpoints.txt`
- `js-assets.txt`
- `diffs/*.sha256`
- `inventory.json` (counts + metadata)
- `cloud-assets.txt` (placeholder until cloud mapping)
- `findings.md` (placeholder until findings pipeline)

## Run Logs
- `runs/YYYY-MM-DD.md` (markdown summary)
- `runs/YYYY-MM-DD.log` (stdout/stderr)

## Contract Guarantees
- Outputs listed above always exist after a run (placeholders allowed).
- `status.json` is always finalized with `finishedAt` + `exitCode`.
