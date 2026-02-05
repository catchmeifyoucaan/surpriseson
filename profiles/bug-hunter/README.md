# Bug Hunter Profile

This profile seeds a multi-agent roster suitable for bug hunting and recon-heavy workflows.

## Apply during init

```bash
surprisebot init --profile-template bug-hunter
```

## What it changes
- Adds `agents.list` with the preseeded roster.
- Leaves models, workspaces, and bindings to defaults.
- Does **not** change channels or auth.

## Notes
- Legacy cron agents are included but optional—remove them if you don't use old cron jobs.
