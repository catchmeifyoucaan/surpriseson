---
summary: "Top-level overview of Surprisebot, features, and purpose"
read_when:
  - Introducing Surprisebot to newcomers
---
# Surprisebot 🦞

> *"EXFOLIATE! EXFOLIATE!"* — A space lobster, probably

<p align="center">
  <img src="whatsapp-surprisebot.jpg" alt="Surprisebot" width="420" />
</p>

<p align="center">
  <strong>Any OS + WhatsApp/Telegram/Discord/iMessage gateway for AI agents (Pi).</strong><br />
  Send a message, get an agent response — from your pocket.
</p>

<p align="center">
  <a href="https://github.com/surprisebot/surprisebot">GitHub</a> ·
  <a href="https://github.com/surprisebot/surprisebot/releases">Releases</a> ·
  <a href="/">Docs</a> ·
  <a href="/start/surprisebot">Surprisebot assistant setup</a>
</p>

Surprisebot bridges WhatsApp (via WhatsApp Web / Baileys), Telegram (Bot API / grammY), Discord (Bot API / channels.discord.js), and iMessage (imsg CLI) to coding agents like [Pi](https://github.com/badlogic/pi-mono).
Surprisebot also powers [Surprisebot](https://surprisebot.me), the space‑lobster assistant.

## Start here

- **New install from zero:** [Getting Started](/start/getting-started)
- **Guided setup (recommended):** [Wizard](/start/wizard) (`surprisebot onboard`)
- **Open the dashboard (local Gateway):** http://127.0.0.1:18789/ (or http://localhost:18789/)

If the Gateway is running on the same computer, that link opens the browser Control UI
immediately. If it fails, start the Gateway first: `surprisebot gateway`.

## Dashboard (browser Control UI)

The dashboard is the browser Control UI for chat, config, nodes, sessions, and more.
Local default: http://127.0.0.1:18789/
Remote access: [Web surfaces](/web) and [Tailscale](/gateway/tailscale)

## How it works

```
WhatsApp / Telegram / Discord
        │
        ▼
  ┌───────────────────────────┐
  │          Gateway          │  ws://127.0.0.1:18789 (loopback-only)
  │     (single source)       │  tcp://0.0.0.0:18790 (Bridge)
  │                           │  http://<gateway-host>:18793
  │                           │    /__surprisebot__/canvas/ (Canvas host)
  └───────────┬───────────────┘
              │
              ├─ Pi agent (RPC)
              ├─ CLI (surprisebot …)
              ├─ Chat UI (SwiftUI)
              ├─ macOS app (Surprisebot.app)
              ├─ iOS node via Bridge + pairing
              └─ Android node via Bridge + pairing
```

Most operations flow through the **Gateway** (`surprisebot gateway`), a single long-running process that owns channel connections and the WebSocket control plane.

## Network model

- **One Gateway per host**: it is the only process allowed to own the WhatsApp Web session.
- **Loopback-first**: Gateway WS defaults to `ws://127.0.0.1:18789`.
  - The wizard now generates a gateway token by default (even for loopback).
  - For Tailnet access, run `surprisebot gateway --bind tailnet --token ...` (token is required for non-loopback binds).
- **Bridge for nodes**: optional LAN/tailnet-facing bridge on `tcp://0.0.0.0:18790` for paired nodes (Bonjour-discoverable).
- **Canvas host**: HTTP file server on `canvasHost.port` (default `18793`), serving `/__surprisebot__/canvas/` for node WebViews; see [Gateway configuration](/gateway/configuration) (`canvasHost`).
- **Remote use**: SSH tunnel or tailnet/VPN; see [Remote access](/gateway/remote) and [Discovery](/gateway/discovery).

## Features (high level)

- 📱 **WhatsApp Integration** — Uses Baileys for WhatsApp Web protocol
- ✈️ **Telegram Bot** — DMs + groups via grammY
- 🎮 **Discord Bot** — DMs + guild channels via channels.discord.js
- 💬 **iMessage** — Local imsg CLI integration (macOS)
- 🤖 **Agent bridge** — Pi (RPC mode) with tool streaming
- ⏱️ **Streaming + chunking** — Block streaming + Telegram draft streaming details ([/concepts/streaming](/concepts/streaming))
- 🧠 **Multi-agent routing** — Route provider accounts/peers to isolated agents (workspace + per-agent sessions)
- 🔐 **Subscription auth** — Anthropic (Claude Pro/Max) + OpenAI (ChatGPT/Codex) via OAuth
- 💬 **Sessions** — Direct chats collapse into shared `main` (default); groups are isolated
- 👥 **Group Chat Support** — Mention-based by default; owner can toggle `/activation always|mention`
- 📎 **Media Support** — Send and receive images, audio, documents
- 🎤 **Voice notes** — Optional transcription hook
- 🖥️ **WebChat + macOS app** — Local UI + menu bar companion for ops and voice wake
- 📱 **iOS node** — Pairs as a node and exposes a Canvas surface
- 📱 **Android node** — Pairs as a node and exposes Canvas + Chat + Camera

Note: legacy Claude/Codex/Gemini/Opencode paths have been removed; Pi is the only coding-agent path.

## Quick start

Runtime requirement: **Node ≥ 22**.

```bash
# Recommended: global install (npm/pnpm)
npm install -g surprisebot@latest
# or: pnpm add -g surprisebot@latest

# Onboard + install the daemon (launchd/systemd user service)
surprisebot onboard --install-daemon

# Pair WhatsApp Web (shows QR)
surprisebot channels login

# Gateway runs via daemon after onboarding; manual run is still possible:
surprisebot gateway --port 18789
```

Switching between npm and git installs later is easy: install the other flavor and run `surprisebot doctor` to update the gateway service entrypoint.

From source (development):

```bash
git clone https://github.com/surprisebot/surprisebot.git
cd surprisebot
pnpm install
pnpm ui:build # auto-installs UI deps on first run
pnpm build
pnpm surprisebot onboard --install-daemon
```

Multi-instance quickstart (optional):

```bash
SURPRISEBOT_CONFIG_PATH=~/.surprisebot/a.json \
SURPRISEBOT_STATE_DIR=~/.surprisebot-a \
surprisebot gateway --port 19001
```

Send a test message (requires a running Gateway):

```bash
surprisebot message send --to +15555550123 --message "Hello from Surprisebot"
```

## Configuration (optional)

Config lives at `~/.surprisebot/surprisebot.json`.

- If you **do nothing**, Surprisebot uses the bundled Pi binary in RPC mode with per-sender sessions.
- If you want to lock it down, start with `channels.whatsapp.allowFrom` and (for groups) mention rules.

Example:

```json5
{
  channels: {
    whatsapp: {
      allowFrom: ["+15555550123"],
      groups: { "*": { requireMention: true } }
    }
  },
  messages: { groupChat: { mentionPatterns: ["@surprisebot"] } }
}
```

## Docs

- Start here:
  - [Docs hubs (all pages linked)](/start/hubs)
  - [FAQ](/start/faq) ← *common questions answered*
  - [Configuration](/gateway/configuration)
  - [Configuration examples](/gateway/configuration-examples)
  - [Slash commands](/tools/slash-commands)
  - [Multi-agent routing](/concepts/multi-agent)
  - [Updating / rollback](/install/updating)
  - [Pairing (DM + nodes)](/start/pairing)
  - [Nix mode](/install/nix)
  - [Surprisebot assistant setup (Surprisebot)](/start/surprisebot)
  - [Skills](/tools/skills)
  - [Skills config](/tools/skills-config)
  - [Workspace templates](/reference/templates/AGENTS)
  - [RPC adapters](/reference/rpc)
  - [Gateway runbook](/gateway)
  - [Nodes (iOS/Android)](/nodes)
  - [Web surfaces (Control UI)](/web)
  - [Discovery + transports](/gateway/discovery)
  - [Remote access](/gateway/remote)
- Providers and UX:
  - [WebChat](/web/webchat)
  - [Control UI (browser)](/web/control-ui)
  - [Telegram](/channels/telegram)
  - [Discord](/channels/discord)
  - [iMessage](/channels/imessage)
  - [Groups](/concepts/groups)
  - [WhatsApp group messages](/concepts/group-messages)
  - [Media: images](/nodes/images)
  - [Media: audio](/nodes/audio)
- Companion apps:
  - [macOS app](/platforms/macos)
  - [iOS app](/platforms/ios)
  - [Android app](/platforms/android)
  - [Windows (WSL2)](/platforms/windows)
  - [Linux app](/platforms/linux)
- Ops and safety:
  - [Sessions](/concepts/session)
  - [Cron jobs](/automation/cron-jobs)
  - [Webhooks](/automation/webhook)
  - [Gmail hooks (Pub/Sub)](/automation/gmail-pubsub)
  - [Security](/gateway/security)
  - [Troubleshooting](/gateway/troubleshooting)

## The name

**Surprisebot = CLAW + TARDIS** — because every space lobster needs a time-and-space machine.

---

*"We're all just playing with our own prompts."* — an AI, probably high on tokens

## Credits

- **Peter Steinberger** ([@steipete](https://twitter.com/steipete)) — Creator, lobster whisperer
- **Mario Zechner** ([@badlogicc](https://twitter.com/badlogicgames)) — Pi creator, security pen-tester
- **Surprisebot** — The space lobster who demanded a better name

## Core Contributors

- **Maxim Vovshin** (@Hyaxia, 36747317+Hyaxia@users.noreply.github.com) — Blogwatcher skill
- **Nacho Iacovino** (@nachoiacovino, nacho.iacovino@gmail.com) — Location parsing (Telegram + WhatsApp)

## License

MIT — Free as a lobster in the ocean 🦞

---

*"We're all just playing with our own prompts."* — An AI, probably high on tokens
