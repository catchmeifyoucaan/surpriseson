---
summary: "Quick troubleshooting guide for common Surprisebot failures"
read_when:
  - Investigating runtime issues or failures
---
# Troubleshooting 🔧

When Surprisebot misbehaves, here's how to fix it.

Start with the FAQ’s [First 60 seconds](/start/faq#first-60-seconds-if-somethings-broken) if you just want a quick triage recipe. This page goes deeper on runtime failures and diagnostics.

Provider-specific shortcuts: [/channels/troubleshooting](/channels/troubleshooting)

## Status & Diagnostics

Quick triage commands (in order):

| Command | What it tells you | When to use it |
|---|---|---|
| `surprisebot status` | Local summary: OS + update, gateway reachability/mode, daemon, agents/sessions, provider config state | First check, quick overview |
| `surprisebot status --all` | Full local diagnosis (read-only, pasteable, safe-ish) incl. log tail | When you need to share a debug report |
| `surprisebot status --deep` | Runs gateway health checks (incl. provider probes; requires reachable gateway) | When “configured” doesn’t mean “working” |
| `surprisebot gateway status` | Gateway discovery + reachability (local + remote targets) | When you suspect you’re probing the wrong gateway |
| `surprisebot channels status --probe` | Asks the running gateway for channel status (and optionally probes) | When gateway is reachable but channels misbehave |
| `surprisebot daemon status` | Supervisor state (launchd/systemd/schtasks), runtime PID/exit, last gateway error | When the daemon “looks loaded” but nothing runs |
| `surprisebot logs --follow` | Live logs (best signal for runtime issues) | When you need the actual failure reason |

**Sharing output:** prefer `surprisebot status --all` (it redacts tokens). If you paste `surprisebot status`, consider setting `SURPRISEBOT_SHOW_SECRETS=0` first (token previews).

See also: [Health checks](/gateway/health) and [Logging](/logging).

## Common Issues

### CI Secrets Scan Failed

This means `detect-secrets` found new candidates not yet in the baseline.
Follow [Secret scanning](/gateway/security#secret-scanning-detect-secrets).

### Service Installed but Nothing is Running

If the gateway service is installed but the process exits immediately, the daemon
can appear “loaded” while nothing is running.

**Check:**
```bash
surprisebot daemon status
surprisebot doctor
```

Doctor/daemon will show runtime state (PID/last exit) and log hints.

**Logs:**
- Preferred: `surprisebot logs --follow`
- File logs (always): `/tmp/surprisebot/surprisebot-YYYY-MM-DD.log` (or your configured `logging.file`)
- macOS LaunchAgent (if installed): `$SURPRISEBOT_STATE_DIR/logs/gateway.log` and `gateway.err.log`
- Linux systemd (if installed): `journalctl --user -u surprisebot-gateway[-<profile>].service -n 200 --no-pager`
- Windows: `schtasks /Query /TN "Surprisebot Gateway (<profile>)" /V /FO LIST`

**Enable more logging:**
- Bump file log detail (persisted JSONL):
  ```json
  { "logging": { "level": "debug" } }
  ```
- Bump console verbosity (TTY output only):
  ```json
  { "logging": { "consoleLevel": "debug", "consoleStyle": "pretty" } }
  ```
- Quick tip: `--verbose` affects **console** output only. File logs remain controlled by `logging.level`.

See [/logging](/logging) for a full overview of formats, config, and access.

### Service Environment (PATH + runtime)

The gateway daemon runs with a **minimal PATH** to avoid shell/manager cruft:
- macOS: `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/bin`
- Linux: `/usr/local/bin`, `/usr/bin`, `/bin`

This intentionally excludes version managers (nvm/fnm/volta/asdf) and package
managers (pnpm/npm) because the daemon does not load your shell init. Runtime
variables like `DISPLAY` should live in `~/.surprisebot/.env` (loaded early by the
gateway).

WhatsApp + Telegram channels require **Node**; Bun is unsupported. If your
service was installed with Bun or a version-managed Node path, run `surprisebot doctor`
to migrate to a system Node install.

### Service Running but Port Not Listening

If the service reports **running** but nothing is listening on the gateway port,
the Gateway likely refused to bind.

**What "running" means here**
- `Runtime: running` means your supervisor (launchd/systemd/schtasks) thinks the process is alive.
- `RPC probe` means the CLI could actually connect to the gateway WebSocket and call `status`.
- Always trust `Probe target:` + `Config (daemon):` as the “what did we actually try?” lines.

**Check:**
- `gateway.mode` must be `local` for `surprisebot gateway` and the daemon.
- If you set `gateway.mode=remote`, the **CLI defaults** to a remote URL. The daemon can still be running locally, but your CLI may be probing the wrong place. Use `surprisebot daemon status` to see the daemon’s resolved port + probe target (or pass `--url`).
- `surprisebot daemon status` and `surprisebot doctor` surface the **last gateway error** from logs when the service looks running but the port is closed.
- Non-loopback binds (`lan`/`tailnet`/`auto`) require auth:
  `gateway.auth.token` (or `SURPRISEBOT_GATEWAY_TOKEN`).
- `gateway.remote.token` is for remote CLI calls only; it does **not** enable local auth.
- `gateway.token` is ignored; use `gateway.auth.token`.

**If `surprisebot daemon status` shows a config mismatch**
- `Config (cli): ...` and `Config (daemon): ...` should normally match.
- If they don’t, you’re almost certainly editing one config while the daemon is running another.
- Fix: rerun `surprisebot daemon install --force` from the same `--profile` / `SURPRISEBOT_STATE_DIR` you want the daemon to use.

**If `surprisebot daemon status` reports service config issues**
- The supervisor config (launchd/systemd/schtasks) is missing current defaults.
- Fix: run `surprisebot doctor` to update it (or `surprisebot daemon install --force` for a full rewrite).

**If `Last gateway error:` mentions “refusing to bind … without auth”**
- You set `gateway.bind` to a non-loopback mode (`lan`/`tailnet`/`auto`) but left auth off.
- Fix: set `gateway.auth.mode` + `gateway.auth.token` (or export `SURPRISEBOT_GATEWAY_TOKEN`) and restart the daemon.

**If `surprisebot daemon status` says `bind=tailnet` but no tailnet interface was found**
- The gateway tried to bind to a Tailscale IP (100.64.0.0/10) but none were detected on the host.
- Fix: bring up Tailscale on that machine (or change `gateway.bind` to `loopback`/`lan`).

**If `Probe note:` says the probe uses loopback**
- That’s expected for `bind=lan`: the gateway listens on `0.0.0.0` (all interfaces), and loopback should still connect locally.
- For remote clients, use a real LAN IP (not `0.0.0.0`) plus the port, and ensure auth is configured.

### Address Already in Use (Port 18789)

This means something is already listening on the gateway port.

**Check:**
```bash
surprisebot daemon status
```

It will show the listener(s) and likely causes (gateway already running, SSH tunnel).
If needed, stop the service or pick a different port.

### Extra Workspace Folders Detected

If you upgraded from older installs, you might still have `~/surprisebot` on disk.
Multiple workspace directories can cause confusing auth or state drift because
only one workspace is active.

**Fix:** keep a single active workspace and archive/remove the rest. See
[Agent workspace](/concepts/agent-workspace#extra-workspace-folders).

### Main chat running in a sandbox workspace

Symptoms: `pwd` or file tools show `~/.surprisebot/sandboxes/...` even though you
expected the host workspace.

**Why:** `agents.defaults.sandbox.mode: "non-main"` keys off `session.mainKey` (default `"main"`).
Group/channel sessions use their own keys, so they are treated as non-main and
get sandbox workspaces.

**Fix options:**
- If you want host workspaces for an agent: set `agents.list[].sandbox.mode: "off"`.
- If you want host workspace access inside sandbox: set `workspaceAccess: "rw"` for that agent.

### "Agent was aborted"

The agent was interrupted mid-response.

**Causes:**
- User sent `stop`, `abort`, `esc`, `wait`, or `exit`
- Timeout exceeded
- Process crashed

**Fix:** Just send another message. The session continues.

### Messages Not Triggering

**Check 1:** Is the sender allowlisted?
```bash
surprisebot status
```
Look for `AllowFrom: ...` in the output.

**Check 2:** For group chats, is mention required?
```bash
# The message must match mentionPatterns or explicit mentions; defaults live in channel groups/guilds.
# Multi-agent: `agents.list[].groupChat.mentionPatterns` overrides global patterns.
grep -n "agents\\|groupChat\\|mentionPatterns\\|channels\\.whatsapp\\.groups\\|channels\\.telegram\\.groups\\|channels\\.imessage\\.groups\\|channels\\.discord\\.guilds" \
  "${SURPRISEBOT_CONFIG_PATH:-$HOME/.surprisebot/surprisebot.json}"
```

**Check 3:** Check the logs
```bash
surprisebot logs --follow
# or if you want quick filters:
tail -f "$(ls -t /tmp/surprisebot/surprisebot-*.log | head -1)" | grep "blocked\\|skip\\|unauthorized"
```

### Pairing Code Not Arriving

If `dmPolicy` is `pairing`, unknown senders should receive a code and their message is ignored until approved.

**Check 1:** Is a pending request already waiting?
```bash
surprisebot pairing list <channel>
```

Pending DM pairing requests are capped at **3 per channel** by default. If the list is full, new requests won’t generate a code until one is approved or expires.

**Check 2:** Did the request get created but no reply was sent?
```bash
surprisebot logs --follow | grep "pairing request"
```

**Check 3:** Confirm `dmPolicy` isn’t `open`/`allowlist` for that channel.

### Image + Mention Not Working

Known issue: When you send an image with ONLY a mention (no other text), WhatsApp sometimes doesn't include the mention metadata.

**Workaround:** Add some text with the mention:
- ❌ `@surprisebot` + image
- ✅ `@surprisebot check this` + image

### Session Not Resuming

**Check 1:** Is the session file there?
```bash
ls -la ~/.surprisebot/agents/<agentId>/sessions/
```

**Check 2:** Is `idleMinutes` too short?
```json
{
  "session": {
    "idleMinutes": 10080  // 7 days
  }
}
```

**Check 3:** Did someone send `/new`, `/reset`, or a reset trigger?

### Agent Timing Out

Default timeout is 30 minutes. For long tasks:

```json
{
  "reply": {
    "timeoutSeconds": 3600  // 1 hour
  }
}
```

Or use the `process` tool to background long commands.

### WhatsApp Disconnected

```bash
# Check local status (creds, sessions, queued events)
surprisebot status
# Probe the running gateway + channels (WA connect + Telegram + Discord APIs)
surprisebot status --deep

# View recent connection events
surprisebot logs --limit 200 | grep "connection\\|disconnect\\|logout"
```

**Fix:** Usually reconnects automatically once the Gateway is running. If you’re stuck, restart the Gateway process (however you supervise it), or run it manually with verbose output:

```bash
surprisebot gateway --verbose
```

If you’re logged out / unlinked:

```bash
surprisebot channels logout
trash "${SURPRISEBOT_STATE_DIR:-$HOME/.surprisebot}/credentials" # if logout can't cleanly remove everything
surprisebot channels login --verbose       # re-scan QR
```

### Media Send Failing

**Check 1:** Is the file path valid?
```bash
ls -la /path/to/your/image.jpg
```

**Check 2:** Is it too large?
- Images: max 6MB
- Audio/Video: max 16MB  
- Documents: max 100MB

**Check 3:** Check media logs
```bash
grep "media\\|fetch\\|download" "$(ls -t /tmp/surprisebot/surprisebot-*.log | head -1)" | tail -20
```

### High Memory Usage

Surprisebot keeps conversation history in memory.

**Fix:** Restart periodically or set session limits:
```json
{
  "session": {
    "historyLimit": 100  // Max messages to keep
  }
}
```

## macOS Specific Issues

### App Crashes when Granting Permissions (Speech/Mic)

If the app disappears or shows "Abort trap 6" when you click "Allow" on a privacy prompt:

**Fix 1: Reset TCC Cache**
```bash
tccutil reset All com.surprisebot.mac.debug
```

**Fix 2: Force New Bundle ID**
If resetting doesn't work, change the `BUNDLE_ID` in [`scripts/package-mac-app.sh`](https://github.com/surprisebot/surprisebot/blob/main/scripts/package-mac-app.sh) (e.g., add a `.test` suffix) and rebuild. This forces macOS to treat it as a new app.

### Gateway stuck on "Starting..."

The app connects to a local gateway on port `18789`. If it stays stuck:

**Fix 1: Stop the supervisor (preferred)**
If the gateway is supervised by launchd, killing the PID will just respawn it. Stop the supervisor first:
```bash
surprisebot daemon status
surprisebot daemon stop
# Or: launchctl bootout gui/$UID/com.surprisebot.gateway (replace with com.surprisebot.<profile> if needed)
```

**Fix 2: Port is busy (find the listener)**
```bash
lsof -nP -iTCP:18789 -sTCP:LISTEN
```

If it’s an unsupervised process, try a graceful stop first, then escalate:
```bash
kill -TERM <PID>
sleep 1
kill -9 <PID> # last resort
```

**Fix 3: Check the CLI install**
Ensure the global `surprisebot` CLI is installed and matches the app version:
```bash
surprisebot --version
npm install -g surprisebot@<version>
```

## Debug Mode

Get verbose logging:

```bash
# Turn on trace logging in config:
#   ${SURPRISEBOT_CONFIG_PATH:-$HOME/.surprisebot/surprisebot.json} -> { logging: { level: "trace" } }
#
# Then run verbose commands to mirror debug output to stdout:
surprisebot gateway --verbose
surprisebot channels login --verbose
```

## Log Locations

| Log | Location |
|-----|----------|
| Gateway file logs (structured) | `/tmp/surprisebot/surprisebot-YYYY-MM-DD.log` (or `logging.file`) |
| Gateway service logs (supervisor) | macOS: `$SURPRISEBOT_STATE_DIR/logs/gateway.log` + `gateway.err.log` (default: `~/.surprisebot/logs/...`; profiles use `~/.surprisebot-<profile>/logs/...`)<br />Linux: `journalctl --user -u surprisebot-gateway[-<profile>].service -n 200 --no-pager`<br />Windows: `schtasks /Query /TN "Surprisebot Gateway (<profile>)" /V /FO LIST` |
| Session files | `$SURPRISEBOT_STATE_DIR/agents/<agentId>/sessions/` |
| Media cache | `$SURPRISEBOT_STATE_DIR/media/` |
| Credentials | `$SURPRISEBOT_STATE_DIR/credentials/` |

## Health Check

```bash
# Supervisor + probe target + config paths
surprisebot daemon status
# Include system-level scans (legacy/extra services, port listeners)
surprisebot daemon status --deep

# Is the gateway reachable?
surprisebot health --json
# If it fails, rerun with connection details:
surprisebot health --verbose

# Is something listening on the default port?
lsof -nP -iTCP:18789 -sTCP:LISTEN

# Recent activity (RPC log tail)
surprisebot logs --follow
# Fallback if RPC is down
tail -20 /tmp/surprisebot/surprisebot-*.log
```

## Reset Everything

Nuclear option:

```bash
surprisebot daemon stop
# If you installed a service and want a clean install:
# surprisebot daemon uninstall

trash "${SURPRISEBOT_STATE_DIR:-$HOME/.surprisebot}"
surprisebot channels login         # re-pair WhatsApp
surprisebot daemon restart           # or: surprisebot gateway
```

⚠️ This loses all sessions and requires re-pairing WhatsApp.

## Getting Help

1. Check logs first: `/tmp/surprisebot/` (default: `surprisebot-YYYY-MM-DD.log`, or your configured `logging.file`)
2. Search existing issues on GitHub
3. Open a new issue with:
   - Surprisebot version
   - Relevant log snippets
   - Steps to reproduce
   - Your config (redact secrets!)

---

*"Have you tried turning it off and on again?"* — Every IT person ever

🦞🔧

### Browser Not Starting (Linux)

If you see `"Failed to start Chrome CDP on port 18800"`:

**Most likely cause:** Snap-packaged Chromium on Ubuntu.

**Quick fix:** Install Google Chrome instead:
```bash
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo dpkg -i google-chrome-stable_current_amd64.deb
```

Then set in config:
```json
{
  "browser": {
    "executablePath": "/usr/bin/google-chrome-stable"
  }
}
```

**Full guide:** See [browser-linux-troubleshooting](/tools/browser-linux-troubleshooting)
