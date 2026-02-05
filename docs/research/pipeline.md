---
summary: "Research pipeline: outputs → incidents → tasks"
read_when:
  - You want automated research → task routing
  - You want to onboard dorking/exposure feeds safely
---

# Research Pipeline

Surprisebot ingests research outputs, creates incidents, and (optionally) auto‑creates tasks in Mission Control.

## Flow
1. **Research job** produces JSON/JSONL output in `research/outputs/`.
2. **Incident watcher** parses output into incidents.
3. **Task router** auto‑creates Mission Control tasks when severity ≥ threshold.

## Output location

Default:

```
~/surprisebot/research/outputs/
```

Override in config:

```json
{
  "research": {
    "outputDir": "/srv/surprisebot/research/outputs"
  }
}
```

## Minimum output schema
Each record should include at least:

```json
{
  "type": "exposure",
  "title": "Potential admin panel exposed",
  "url": "https://target.example/admin",
  "evidence": ["http 200", "login form"]
}
```

## Auto‑task creation

```json
{
  "missionControl": {
    "incidents": {
      "minSeverity": "medium",
      "defaultPriority": "medium",
      "requireEvidence": true,
      "minEvidenceCount": 2
    }
  }
}
```

If `requireEvidence` is enabled, tasks are created only when a URL + enough evidence are present.

## Research cron jobs

Use cron jobs to schedule research. Example (hourly exposure scan):

```json
{
  "name": "research-exposures-hourly",
  "cron": "0 * * * *",
  "job": {
    "kind": "agentTurn",
    "agentId": "research-exposures",
    "message": "Run exposure scan and write JSONL to research/outputs/"
  }
}
```

See: [Automation & cron jobs](/automation/cron-jobs)
