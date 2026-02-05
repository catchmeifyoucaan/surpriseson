---
summary: "CLI reference for `surprisebot browser` (profiles, tabs, actions, extension relay, remote serve)"
read_when:
  - You use `surprisebot browser` and want examples for common tasks
  - You want to control a remote browser via `browser.controlUrl`
  - You want to use the Chrome extension relay (attach/detach via toolbar button)
---

# `surprisebot browser`

Manage Surprisebot’s browser control server and run browser actions (tabs, snapshots, screenshots, navigation, clicks, typing).

Related:
- Browser tool + API: [Browser tool](/tools/browser)
- Chrome extension relay: [Chrome extension](/tools/chrome-extension)

## Common flags

- `--url <controlUrl>`: override `browser.controlUrl` for this command invocation.
- `--browser-profile <name>`: choose a browser profile (default comes from config).
- `--json`: machine-readable output (where supported).

## Quick start (local)

```bash
surprisebot browser --browser-profile chrome tabs
surprisebot browser --browser-profile surprisebot start
surprisebot browser --browser-profile surprisebot open https://example.com
surprisebot browser --browser-profile surprisebot snapshot
```

## Profiles

Profiles are named browser routing configs. In practice:
- `surprisebot`: launches/attaches to a dedicated Surprisebot-managed Chrome instance (isolated user data dir).
- `chrome`: controls your existing Chrome tab(s) via the Chrome extension relay.

```bash
surprisebot browser profiles
surprisebot browser create-profile --name work --color "#FF5A36"
surprisebot browser delete-profile --name work
```

Use a specific profile:

```bash
surprisebot browser --browser-profile work tabs
```

## Tabs

```bash
surprisebot browser tabs
surprisebot browser open https://docs.surprisebot.bot
surprisebot browser focus <targetId>
surprisebot browser close <targetId>
```

## Snapshot / screenshot / actions

Snapshot:

```bash
surprisebot browser snapshot
```

Screenshot:

```bash
surprisebot browser screenshot
```

Navigate/click/type (ref-based UI automation):

```bash
surprisebot browser navigate https://example.com
surprisebot browser click <ref>
surprisebot browser type <ref> "hello"
```

## Chrome extension relay (attach via toolbar button)

This mode lets the agent control an existing Chrome tab that you attach manually (it does not auto-attach).

Install the unpacked extension to a stable path:

```bash
surprisebot browser extension install
surprisebot browser extension path
```

Then Chrome → `chrome://extensions` → enable “Developer mode” → “Load unpacked” → select the printed folder.

Full guide: [Chrome extension](/tools/chrome-extension)

## Remote browser control (`surprisebot browser serve`)

If the Gateway runs on a different machine than the browser, run a standalone browser control server on the machine that runs Chrome:

```bash
surprisebot browser serve --bind 127.0.0.1 --port 18791 --token <token>
```

Then point the Gateway at it using `browser.controlUrl` + `browser.controlToken` (or `SURPRISEBOT_BROWSER_CONTROL_TOKEN`).

Security + TLS best-practices: [Browser tool](/tools/browser), [Tailscale](/gateway/tailscale), [Security](/gateway/security)
