---
summary: "CLI reference for `surprisebot init` (bootstrap state + workspace + onboarding)"
read_when:
  - First-time bootstrap of Surprisebot on a new machine
  - You want a single command that creates state/workspace + runs onboarding
---

# `surprisebot init`

Bootstrap state + workspace, then run onboarding (wizard) unless skipped.

## Examples

```bash
surprisebot init
surprisebot init --workspace ~/surprisebot
surprisebot init --skip-onboard
```

### Set a custom home/state root

```bash
surprisebot init --home /srv/surprisebot
# or
surprisebot init --state-dir /srv/surprisebot/state
```

### Install optional tooling

```bash
surprisebot init --install-bun --install-qmd
surprisebot init --install-docker
```

### Non-interactive

```bash
surprisebot init --non-interactive --accept-risk --skip-onboard
```

## Notes

- `--home` sets `SURPRISEBOT_HOME` for this run. Export it in your shell to keep using the same layout.
- `--state-dir` sets `SURPRISEBOT_STATE_DIR` for this run.
- `--skip-health` disables the disk/RAM guard.
- `--allow-low-resources` overrides the guard when resources are low.

Related: [`setup`](/cli/setup), [`onboard`](/cli/onboard), [`daemon`](/cli/daemon)

### Presets

```bash
# QuickStart flow
surprisebot init --quickstart

# Advanced flow
surprisebot init --advanced

# Minimal: skip skills + UI
surprisebot init --minimal

# Full: enable optional installs + daemon
surprisebot init --full
```
