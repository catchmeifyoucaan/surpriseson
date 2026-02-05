---
summary: "Gateway runtime on macOS (external launchd service)"
read_when:
  - Packaging Surprisebot.app
  - Debugging the macOS gateway launchd service
  - Installing the gateway CLI for macOS
---

# Gateway on macOS (external launchd)

Surprisebot.app no longer bundles Node/Bun or the Gateway runtime. The macOS app
expects an **external** `surprisebot` CLI install and manages a per‑user launchd
service to keep the Gateway running.

## Install the CLI (required for local mode)

You need Node 22+ on the Mac, then install `surprisebot` globally:

```bash
npm install -g surprisebot@<version>
```

The macOS app’s **Install CLI** button runs the same flow via npm/pnpm (bun not recommended for Gateway runtime).

## Launchd (Gateway as LaunchAgent)

Label:
- `com.surprisebot.gateway` (or `com.surprisebot.<profile>`)

Plist location (per‑user):
- `~/Library/LaunchAgents/com.surprisebot.gateway.plist`
  (or `~/Library/LaunchAgents/com.surprisebot.<profile>.plist`)

Manager:
- The macOS app owns LaunchAgent install/update in Local mode.
- The CLI can also install it: `surprisebot daemon install`.

Behavior:
- “Surprisebot Active” enables/disables the LaunchAgent.
- App quit does **not** stop the gateway (launchd keeps it alive).

Logging:
- launchd stdout/err: `/tmp/surprisebot/surprisebot-gateway.log`

## Version compatibility

The macOS app checks the gateway version against its own version. If they’re
incompatible, update the global CLI to match the app version.

## Smoke check

```bash
surprisebot --version

SURPRISEBOT_SKIP_CHANNELS=1 \
SURPRISEBOT_SKIP_CANVAS_HOST=1 \
surprisebot gateway --port 18999 --bind loopback
```

Then:

```bash
surprisebot gateway call health --url ws://127.0.0.1:18999 --timeout 3000
```
