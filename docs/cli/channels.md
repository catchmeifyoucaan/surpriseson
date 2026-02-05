---
summary: "CLI reference for `surprisebot channels` (accounts, status, login/logout, logs)"
read_when:
  - You want to add/remove channel accounts (WhatsApp/Telegram/Discord/Slack/Signal/iMessage)
  - You want to check channel status or tail channel logs
---

# `surprisebot channels`

Manage chat channel accounts and their runtime status on the Gateway.

Related docs:
- Channel guides: [Channels](/channels/index)
- Gateway configuration: [Configuration](/gateway/configuration)

## Common commands

```bash
surprisebot channels list
surprisebot channels status
surprisebot channels logs --channel all
```

## Add / remove accounts

```bash
surprisebot channels add --channel telegram --token <bot-token>
surprisebot channels remove --channel telegram --delete
```

Tip: `surprisebot channels add --help` shows per-channel flags (token, app token, signal-cli paths, etc).

## Login / logout (interactive)

```bash
surprisebot channels login --channel whatsapp
surprisebot channels logout --channel whatsapp
```

## Troubleshooting

- Run `surprisebot status --deep` for a broad probe.
- Use `surprisebot doctor` for guided fixes.

