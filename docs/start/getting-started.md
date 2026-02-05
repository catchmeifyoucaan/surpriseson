---
summary: "Beginner guide: from zero to first message (wizard, auth, channels, pairing)"
read_when:
  - First time setup from zero
  - You want the fastest path from install → onboarding → first message
---

# Getting Started

Goal: go from **zero** → **first working chat** (with sane defaults) as quickly as possible.


If you want a lighter install (no Docker/Neo4j/QMD), see [Minimal mode](/start/minimal).

Recommended path: use **`surprisebot init`** (bootstrap + onboarding).

New? See [Start Here](/start/start-here) to choose Minimal/Standard/Full. It sets up:
- model/auth (OAuth recommended)
- gateway settings
- channels (WhatsApp/Telegram/Discord/…)
- pairing defaults (secure DMs)
- workspace bootstrap + skills
- optional background daemon

If you want the deeper reference pages, jump to: [Wizard](/start/wizard), [Setup](/start/setup), [Pairing](/start/pairing), [Security](/gateway/security).

Sandboxing note: `agents.defaults.sandbox.mode: "non-main"` uses `session.mainKey` (default `"main"`),
so group/channel sessions are sandboxed. If you want the main agent to always
run on host, set an explicit per-agent override:

```json
{
  "routing": {
    "agents": {
      "main": {
        "workspace": "~/surprisebot",
        "sandbox": { "mode": "off" }
      }
    }
  }
}
```

## 0) Prereqs

- Node `>=22`
- `pnpm` (optional; recommended if you build from source)
- **Recommended:** Brave Search API key for web search. Easiest path:
  `surprisebot configure --section web` (stores `tools.web.search.apiKey`).
  See [Web tools](/tools/web).

macOS: if you plan to build the apps, install Xcode / CLT. For the CLI + gateway only, Node is enough.
Windows: use **WSL2** (Ubuntu recommended). WSL2 is strongly recommended; native Windows is untested and more problematic. Install WSL2 first, then run the Linux steps inside WSL. See [Windows (WSL2)](/platforms/windows).

## 1) Install the CLI (recommended)

```bash
curl -fsSL https://surprisebot.bot/install.sh | bash
```

Installer options (install method, non-interactive, from GitHub): [Install](/install).

Windows (PowerShell):

```powershell
iwr -useb https://surprisebot.bot/install.ps1 | iex
```

Alternative (global install):

```bash
npm install -g surprisebot@latest
```

```bash
pnpm add -g surprisebot@latest
```

## 2) Run the onboarding wizard (and install the daemon)

```bash
surprisebot init --quickstart --install-daemon
# or (legacy)
surprisebot onboard --install-daemon
```

Optional: preseed the bug-hunter roster:

```bash
surprisebot init --profile-template bug-hunter
```

See [Profiles](/start/profiles) for details.


What you’ll choose:
- **Local vs Remote** gateway
- **Auth**: OpenAI Code (Codex) subscription (OAuth) or API keys. For Anthropic we recommend an API key; `claude setup-token` is also supported.
- **Providers**: WhatsApp QR login, Telegram/Discord bot tokens, etc.
- **Daemon**: background install (launchd/systemd; WSL2 uses systemd)
  - **Runtime**: Node (recommended; required for WhatsApp/Telegram). Bun is **not recommended**.
- **Gateway token**: the wizard generates one by default (even on loopback) and stores it in `gateway.auth.token`.

Wizard doc: [Wizard](/start/wizard)

### Auth: where it lives (important)

- **Recommended Anthropic path:** set an API key (wizard can store it for daemon use). `claude setup-token` is also supported if you want to reuse Claude Code credentials.

- OAuth credentials (legacy import): `~/.surprisebot/credentials/oauth.json`
- Auth profiles (OAuth + API keys): `~/.surprisebot/agents/<agentId>/agent/auth-profiles.json`

Headless/server tip: do OAuth on a normal machine first, then copy `oauth.json` to the gateway host.

## 3) Start the Gateway

If you installed the daemon during onboarding, the Gateway should already be running:

```bash
surprisebot daemon status
```

Manual run (foreground):

```bash
surprisebot gateway --port 18789 --verbose
```

Dashboard (local loopback): `http://127.0.0.1:18789/`
If a token is configured, paste it into the Control UI settings (stored as `connect.params.auth.token`).

⚠️ **Bun warning (WhatsApp + Telegram):** Bun has known issues with these
channels. If you use WhatsApp or Telegram, run the Gateway with **Node**.

## 4) Pair + connect your first chat surface

### WhatsApp (QR login)

```bash
surprisebot channels login
```

Scan via WhatsApp → Settings → Linked Devices.

WhatsApp doc: [WhatsApp](/channels/whatsapp)

### Telegram / Discord / others

The wizard can write tokens/config for you. If you prefer manual config, start with:
- Telegram: [Telegram](/channels/telegram)
- Discord: [Discord](/channels/discord)

**Telegram DM tip:** your first DM returns a pairing code. Approve it (see next step) or the bot won’t respond.

## 5) DM safety (pairing approvals)

Default posture: unknown DMs get a short code and messages are not processed until approved.
If your first DM gets no reply, approve the pairing:

```bash
surprisebot pairing list whatsapp
surprisebot pairing approve whatsapp <code>
```

Pairing doc: [Pairing](/start/pairing)

### Advanced features (optional)

- Mission Control ledger + reports: [/mission-control](/mission-control)
- Budget enforcement: [/gateway/budgets](/gateway/budgets)
- Research pipeline: [/research/pipeline](/research/pipeline)
- QMD local search: [/tools/qmd](/tools/qmd)
- Memory graph (Neo4j): [/concepts/memory](/concepts/memory)
- ARTEMIS integration (advanced): [/advanced/artemis](/advanced/artemis)
- Bug Hunter Stack (end‑to‑end): [/advanced/bug-hunter-stack](/advanced/bug-hunter-stack)


## From source (development)

If you’re hacking on Surprisebot itself, run from source:

```bash
git clone https://github.com/surprisebot/surprisebot.git
cd surprisebot
pnpm install
pnpm ui:build # auto-installs UI deps on first run
pnpm build
pnpm surprisebot onboard --install-daemon
```

Gateway (from this repo):

```bash
node dist/entry.js gateway --port 18789 --verbose
```

## 7) Verify end-to-end

In a new terminal:

```bash
surprisebot status
surprisebot health
surprisebot message send --to +15555550123 --message "Hello from Surprisebot"
```

If `health` shows “no auth configured”, go back to the wizard and set OAuth/key auth — the agent won’t be able to respond without it.

Tip: `surprisebot status --all` is the best pasteable, read-only debug report.
Health probes: `surprisebot health` (or `surprisebot status --deep`) asks the running gateway for a health snapshot.

## Next steps (optional, but great)

- macOS menu bar app + voice wake: [macOS app](/platforms/macos)
- iOS/Android nodes (Canvas/camera/voice): [Nodes](/nodes)
- Remote access (SSH tunnel / Tailscale Serve): [Remote access](/gateway/remote) and [Tailscale](/gateway/tailscale)
