---
summary: "CLI reference for `surprisebot models` (status/list/set/scan, aliases, fallbacks, auth)"
read_when:
  - You want to change default models or view provider auth status
  - You want to scan available models/providers and debug auth profiles
---

# `surprisebot models`

Model discovery, scanning, and configuration (default model, fallbacks, auth profiles).

Related:
- Providers + models: [Models](/providers/models)
- Provider auth setup: [Getting started](/start/getting-started)

## Common commands

```bash
surprisebot models status
surprisebot models list
surprisebot models set <model-or-alias>
surprisebot models scan
```

## Aliases + fallbacks

```bash
surprisebot models aliases list
surprisebot models fallbacks list
```

## Auth profiles

```bash
surprisebot models auth add
surprisebot models auth setup-token
surprisebot models auth paste-token
```

