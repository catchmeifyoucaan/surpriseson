---
summary: "Start here: pick Minimal, Standard, or Full Stack"
read_when:
  - You want the fastest path to a working Surprisebot
  - You want to choose between minimal/standard/full
---

# Start Here

Pick the path that fits your machine + workload.

## 1) Minimal (fastest + lightest)
- CLI + Gateway only
- No Docker, Neo4j, or QMD

```bash
npm install -g surprisebot@latest
surprisebot init --minimal
surprisebot gateway --port 18789
```

## 2) Standard (recommended)
- CLI + Gateway + onboarding
- Optional QMD/Bun

```bash
curl -fsSL https://surprisebot.bot/install.sh | bash
# runs: surprisebot init --quickstart
```

## 3) Full Stack (power users)
- Docker + QMD + advanced tools
- Best for heavy recon + automation

```bash
surprisebot init --quickstart --install-daemon --install-bun --install-qmd --install-docker
```

If you’re unsure, start with **Standard** and add heavy components later.


## Optional: Bug Hunter profile (preseeded roster)
- Preloads the multi-agent roster used for bug hunting
- Does **not** change channels or auth

```bash
surprisebot init --profile-template bug-hunter
```

