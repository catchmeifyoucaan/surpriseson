---
summary: "Mission Control CLI commands (tasks, reports, maintenance)"
read_when:
  - Using the mission-control CLI for tasks, reports, or maintenance
---

# `surprisebot mission-control`

Mission Control CLI helpers for tasks, reports, mirroring, and maintenance.

## Commands

### `task:list`
List tasks from the local ledger.

```bash
surprisebot mission-control task:list --status assigned --limit 20
```

### `task:create`
Create a task in the ledger.

```bash
surprisebot mission-control task:create --title "Investigate exposure" --description "Check /admin" --priority medium
```

### `task:update`
Update task status.

```bash
surprisebot mission-control task:update --id task-123 --status done
```

### `mirror`
Mirror the Mission Control snapshot to configured sinks.

```bash
surprisebot mission-control mirror
```

### `report`
Generate a report (daily/weekly/health).

```bash
surprisebot mission-control report --kind daily
```

### `maintenance`
Prune duplicate incidents/tasks in the ledger.

```bash
surprisebot mission-control maintenance
```
