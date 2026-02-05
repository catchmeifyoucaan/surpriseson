---
summary: "CLI reference for `surprisebot plugins` (list, install, enable/disable, doctor)"
read_when:
  - You want to install or manage in-process Gateway plugins
  - You want to debug plugin load failures
---

# `surprisebot plugins`

Manage Gateway plugins/extensions (loaded in-process).

Related:
- Plugin system: [Plugins](/plugin)
- Security hardening: [Security](/gateway/security)

## Commands

```bash
surprisebot plugins list
surprisebot plugins info <id>
surprisebot plugins enable <id>
surprisebot plugins disable <id>
surprisebot plugins doctor
```

### Install

```bash
surprisebot plugins install <npm-spec>
```

Security note: treat plugin installs like running code. Prefer pinned versions.

