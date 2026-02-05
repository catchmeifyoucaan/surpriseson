---
summary: "CLI reference for `surprisebot setup` (initialize config + workspace)"
read_when:
  - You’re doing first-run setup without the full onboarding wizard
  - You want to set the default workspace path
---

# `surprisebot setup`

Initialize the Surprisebot config (state dir) and the agent workspace. Default state dir is `~/.surprisebot` or `$SURPRISEBOT_HOME/state`.

Related:
- Getting started: [Getting started](/start/getting-started)
- Wizard: [Onboarding](/start/onboarding)

## Examples

```bash
surprisebot setup
surprisebot setup --workspace ~/surprisebot
```

To run the wizard via setup:

```bash
surprisebot setup --wizard
```

