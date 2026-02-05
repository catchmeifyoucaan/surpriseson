# Export / Migrate Surprisesons

Use this when moving to a new machine or publishing an open‑source bundle.

## Copy these paths
1) /root/clawd               (agent workspace)
2) /root/.surprisebot            (gateway config + cron state + memory)
3) /root/.codex               (Codex auth profiles)
4) /root/.agents/skills       (shared skill catalog)
5) /root/surprisebot    (portable workspace root)

## Recommended backup (private)
```
sudo tar czf surprisebot-backup.tgz \
  /root/clawd \
  /root/.surprisebot \
  /root/.codex \
  /root/.agents/skills
```

## Public export checklist
- Remove secrets from `/root/.surprisebot/.env`.
- Remove auth profiles from `/root/.codex`.
- Remove any tokens or private logs in `/root/clawd`.

## Restore
```
sudo tar xzf surprisebot-backup.tgz -C /
```

Then restart the gateway:
```
sudo systemctl restart surprisebot-gateway.service
```
