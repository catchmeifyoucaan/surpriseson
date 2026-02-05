---
summary: "One-shot Surprisebot deployment checklist (paths, env, and startup)"
read_when:
  - You want to bootstrap a new Surprisebot host
---

# Surprisebot deploy checklist

Use this when bootstrapping a new host or moving Surprisebot to a different machine.

## 1) Required paths (create once)

- Workspace (default): `~/surprisebot`
- Surprisebot agent: `~/surprisebot/surprisebot`
- Shared skills: `/srv/surprisebot/skills-shared`
- Codex seats: `~/.codex/seat1` … `~/.codex/seat5`

## 2) One-shot filesystem setup

```bash
# shared skills (single source of truth)
sudo mkdir -p /srv/surprisebot/skills-shared
sudo chown -R "$USER":"$USER" /srv/surprisebot/skills-shared

# codex seats (each seat has its own auth.json)
mkdir -p ~/.codex/seat{1..5}
for i in 1 2 3 4 5; do
  ln -sfn /srv/surprisebot/skills-shared ~/.codex/seat${i}/skills
done

# claw workspace + surprisebot
mkdir -p ~/surprisebot/surprisebot
ln -sfn /srv/surprisebot/skills-shared ~/surprisebot/skills
ln -sfn ~/surprisebot/skills ~/surprisebot/surprisebot/skills
```

## 3) Required environment variables

Store these in `~/.surprisebot/.env` (or your systemd unit environment):

- `BRAVE_API_KEY`
- `SERPER_API_KEY`
- `SERPAPI_API_KEY`
- `PPLX_API_KEY`
- `GEMINI_API_KEY` (comma-separated keys are supported)
- `ANTHROPIC_API_KEY` (if using Claude models)

## 4) One-shot config

```bash
# load or update config
surprisebot configure --section web
```

Verify:
- `tools.web.search.provider` is set to `hybrid`
- `tools.web.search.serpapiEngines` contains your desired engines
- Surprisebot is set as the default agent in `~/.surprisebot/surprisebot.json`

## 5) Start / Restart

```bash
sudo systemctl restart surprisebot-gateway.service
```

## 6) Quick smoke checks

```bash
surprisebot models list
surprisebot skills list
```

If using multiple Codex seats, ensure each `~/.codex/seatN/auth.json` exists.
