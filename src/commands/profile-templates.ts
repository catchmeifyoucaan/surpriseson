import fs from "node:fs/promises";
import path from "node:path";
import JSON5 from "json5";

import type { SurprisebotConfig } from "../config/config.js";
import { resolveSurprisebotPackageRoot } from "../infra/surprisebot-root.js";

const PROFILE_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export async function loadProfileTemplateConfig(name: string): Promise<{
  config: SurprisebotConfig;
  sourcePath: string;
} | null> {
  const trimmed = name.trim();
  if (!trimmed || !PROFILE_NAME_RE.test(trimmed)) return null;
  const root = await resolveSurprisebotPackageRoot({
    cwd: process.cwd(),
    argv1: process.argv[1],
    moduleUrl: import.meta.url,
  });
  if (!root) return null;
  const templatePath = path.join(root, "profiles", trimmed, "agents.json5");
  try {
    const raw = await fs.readFile(templatePath, "utf-8");
    const parsed = JSON5.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return { config: parsed as SurprisebotConfig, sourcePath: templatePath };
  } catch {
    return null;
  }
}
