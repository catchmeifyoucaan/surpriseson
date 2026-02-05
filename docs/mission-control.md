---
summary: "Mission Control: shared tasks, activity ledger, reports"
read_when:
  - You want the task ledger + reports for multi-agent work
  - You want to understand Mission Control storage + rollups
---

# Mission Control

Mission Control is the **local task ledger** and reporting system that turns Surprisebot into a coordinated multi‑agent team.

It provides:
- **JSONL ledgers** for tasks, messages, activities, documents, subscriptions, signals, run‑ledger, and budget‑ledger.
- **Rollups** for long‑running systems (daily rollup keeps files small).
- **CLI helpers** to create tasks, update status, and generate reports.

## Where data lives

Default ledger location:

```
~/.surprisebot/memory/mission-control/
```

You can override:

```json
{
  "missionControl": {
    "ledgerDir": "/srv/surprisebot/memory/mission-control"
  }
}
```

## CLI

```bash
surprisebot mission-control task:list --status assigned --limit 20
surprisebot mission-control task:create --title "Investigate exposure" --priority medium
surprisebot mission-control report --kind daily
surprisebot mission-control maintenance
```

See: [`surprisebot mission-control`](/cli/mission-control)

## Rollups

Rollups run on a schedule and are safe to run manually:

```bash
surprisebot mission-control maintenance
```

Rollups are stored under:

```
~/.surprisebot/memory/mission-control/rollups/YYYY-MM-DD/
```

## Incident → Task flow

When research outputs or incident watchers fire, Surprisebot can auto‑create tasks in Mission Control.
That path is controlled by `missionControl.incidents` config and severity thresholds.

See: [Research pipeline](/research/pipeline)


## Kill switch & budgets

You can pause automatic incident → task creation (and downstream alerting) with:

```json
{
  "missionControl": {
    "killSwitch": true
  }
}
```

Budget enforcement is configured separately under `budgets` and surfaced in the Mission Control UI.
