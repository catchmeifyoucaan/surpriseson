---
summary: "Model authentication: OAuth, API keys, and Claude Code token reuse"
read_when:
  - Debugging model auth or OAuth expiry
  - Documenting authentication or credential storage
---
# Authentication

Surprisebot supports OAuth and API keys for model providers. For Anthropic
accounts, we recommend using an **API key**. Surprisebot can also reuse Claude Code
credentials, including the long‑lived token created by `claude setup-token`.

See [/concepts/oauth](/concepts/oauth) for the full OAuth flow and storage
layout.

## Recommended Anthropic setup (API key)

If you’re using Anthropic directly, use an API key.

1) Create an API key in the Anthropic Console.
2) Put it on the **gateway host** (the machine running `surprisebot gateway`).

```bash
export ANTHROPIC_API_KEY="..."
surprisebot models status
```

3) If the Gateway runs under systemd/launchd, prefer putting the key in
`~/.surprisebot/.env` so the daemon can read it:

```bash
cat >> ~/.surprisebot/.env <<'EOF'
ANTHROPIC_API_KEY=...
EOF
```

Then restart the daemon (or restart your Gateway process) and re-check:

```bash
surprisebot models status
surprisebot doctor
```

If you’d rather not manage env vars yourself, the onboarding wizard can store
API keys for daemon use: `surprisebot onboard`.

See [/start/faq](/start/faq) for details on env inheritance (`env.shellEnv`,
`~/.surprisebot/.env`, systemd/launchd).

## Anthropic: Claude Code CLI setup-token (supported)

For Anthropic, the recommended path is an **API key**. If you’re already using
Claude Code CLI, the setup-token flow is also supported.
Run it on the **gateway host**:

```bash
claude setup-token
```

Then verify and sync into Surprisebot:

```bash
surprisebot models status
surprisebot doctor
```

This should create (or refresh) an auth profile like `anthropic:claude-cli` in
the agent auth store.

Surprisebot config sets `auth.profiles["anthropic:claude-cli"].mode` to `"oauth"` so
the profile accepts both OAuth and setup-token credentials. Older configs that
used `"token"` are auto-migrated on load.

If you see an Anthropic error like:

```
This credential is only authorized for use with Claude Code and cannot be used for other API requests.
```

…use an Anthropic API key instead.

Alternative: run the wrapper (also updates Surprisebot config):

```bash
surprisebot models auth setup-token --provider anthropic
```

Manual token entry (any provider; writes `auth-profiles.json` + updates config):

```bash
surprisebot models auth paste-token --provider anthropic
surprisebot models auth paste-token --provider openrouter
```

Automation-friendly check (exit `1` when expired/missing, `2` when expiring):

```bash
surprisebot models status --check
```

Optional ops scripts (systemd/Termux) are documented here:
[/automation/auth-monitoring](/automation/auth-monitoring)

`surprisebot models status` loads Claude Code credentials into Surprisebot’s
`auth-profiles.json` and shows expiry (warns within 24h by default).
`surprisebot doctor` also performs the sync when it runs.

> `claude setup-token` requires an interactive TTY.

## Checking model auth status

```bash
surprisebot models status
surprisebot doctor
```

## Controlling which credential is used

### Per-session (chat command)

Use `/model <alias-or-id>@<profileId>` to pin a specific provider credential for the current session (example profile ids: `anthropic:claude-cli`, `anthropic:default`).

Use `/model` (or `/model list`) for a compact picker; use `/model status` for the full view (candidates + next auth profile, plus provider endpoint details when configured).

### Per-agent (CLI override)

Set an explicit auth profile order override for an agent (stored in that agent’s `auth-profiles.json`):

```bash
surprisebot models auth order get --provider anthropic
surprisebot models auth order set --provider anthropic anthropic:claude-cli
surprisebot models auth order clear --provider anthropic
```

Use `--agent <id>` to target a specific agent; omit it to use the configured default agent.

## How sync works

1. **Claude Code** stores credentials in `~/.claude/.credentials.json` (or
   Keychain on macOS).
2. **Surprisebot** syncs those into
   `~/.surprisebot/agents/<agentId>/agent/auth-profiles.json` when the auth store is
   loaded.
3. Refreshable OAuth profiles can be refreshed automatically on use. Static
   token profiles (including Claude Code CLI setup-token) are not refreshable by
   Surprisebot.

## Troubleshooting

### “No credentials found”

If the Anthropic token profile is missing, run `claude setup-token` on the
**gateway host**, then re-check:

```bash
surprisebot models status
```

### Token expiring/expired

Run `surprisebot models status` to confirm which profile is expiring. If the profile
is `anthropic:claude-cli`, rerun `claude setup-token`.

## Requirements

- Claude Max or Pro subscription (for `claude setup-token`)
- Claude Code CLI installed (`claude` command available)
