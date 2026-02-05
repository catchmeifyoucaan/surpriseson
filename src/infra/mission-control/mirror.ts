import fs from "node:fs/promises";

import type { SurprisebotConfig } from "../../config/config.js";
import { listTasks } from "./db.js";
import { readMissionControlRecords } from "./ledger.js";

export async function buildMissionControlSnapshot(cfg: SurprisebotConfig) {
  const tasks = listTasks(cfg, { limit: 1000 });
  const activities = await readMissionControlRecords({ cfg, kind: "activities", limit: 500 });
  const messages = await readMissionControlRecords({ cfg, kind: "messages", limit: 500 });
  return { generatedAt: new Date().toISOString(), tasks, activities, messages };
}

export async function runMissionControlMirror(cfg: SurprisebotConfig) {
  const mirror = cfg.missionControl?.mirror;
  if (!mirror?.enabled) return { ok: false, reason: "mirror disabled" } as const;
  const payload = await buildMissionControlSnapshot(cfg);

  if (mirror.file?.path) {
    await fs.mkdir(require("node:path").dirname(mirror.file.path), { recursive: true });
    await fs.writeFile(mirror.file.path, JSON.stringify(payload, null, 2));
  }

  if (mirror.webhook?.url) {
    const res = await fetch(mirror.webhook.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(mirror.webhook.headers ?? {}),
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, reason: `webhook ${res.status}` } as const;
    }
  }

  return { ok: true } as const;
}
