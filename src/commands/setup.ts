import fs from "node:fs/promises";
import path from "node:path";

import JSON5 from "json5";

import { ensureAgentWorkspace, resolveDefaultAgentWorkspaceDir } from "../agents/workspace.js";
import { type SurprisebotConfig } from "../config/config.js";
import { resolveConfigPath } from "../config/paths.js";
import { applyModelDefaults } from "../config/defaults.js";
import { resolveSessionTranscriptsDir } from "../config/sessions.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";

async function readConfigFileRaw(): Promise<{
  exists: boolean;
  parsed: SurprisebotConfig;
}> {
  const configPath = resolveConfigPath();
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    const parsed = JSON5.parse(raw);
    if (parsed && typeof parsed === "object") {
      return { exists: true, parsed: parsed as SurprisebotConfig };
    }
    return { exists: true, parsed: {} };
  } catch {
    return { exists: false, parsed: {} };
  }
}


function mergeDefaults<T extends Record<string, any>>(target: T, defaults: T): T {
  const out: any = Array.isArray(target) ? [...target] : { ...target };
  for (const [key, value] of Object.entries(defaults)) {
    const existing = (out as any)[key];
    if (existing === undefined) {
      (out as any)[key] = value;
    } else if (existing && value && typeof existing === "object" && typeof value === "object" && !Array.isArray(existing) && !Array.isArray(value)) {
      (out as any)[key] = mergeDefaults(existing, value);
    }
  }
  return out as T;
}

async function writeConfigFile(cfg: SurprisebotConfig) {
  const configPath = resolveConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const json = JSON.stringify(applyModelDefaults(cfg), null, 2).trimEnd().concat("\n");
  await fs.writeFile(configPath, json, "utf-8");
}

export async function setupCommand(
  opts?: { workspace?: string; overrides?: SurprisebotConfig; profileTemplate?: SurprisebotConfig },
  runtime: RuntimeEnv = defaultRuntime,
) {
  const desiredWorkspace =
    typeof opts?.workspace === "string" && opts.workspace.trim()
      ? opts.workspace.trim()
      : undefined;

  const existingRaw = await readConfigFileRaw();
  const cfg = existingRaw.parsed;
  const defaults = cfg.agents?.defaults ?? {};

  const workspace = desiredWorkspace ?? defaults.workspace ?? resolveDefaultAgentWorkspaceDir();

  const nextBase: SurprisebotConfig = {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...defaults,
        workspace,
      },
    },
  };

  const templated = opts?.profileTemplate ? mergeDefaults(nextBase, opts.profileTemplate) : nextBase;
  const next = opts?.overrides ? mergeDefaults(templated, opts.overrides) : templated;

  if (!existingRaw.exists || defaults.workspace !== workspace || opts?.overrides) {
    await writeConfigFile(next);
    const configPath = resolveConfigPath();
    runtime.log(
      !existingRaw.exists
        ? `Wrote ${configPath}`
        : `Updated ${configPath} (set agents.defaults.workspace)`,
    );
  } else {
    runtime.log(`Config OK: ${resolveConfigPath()}`);
  }

  const ws = await ensureAgentWorkspace({
    dir: workspace,
    ensureBootstrapFiles: !next.agents?.defaults?.skipBootstrap,
  });
  runtime.log(`Workspace OK: ${ws.dir}`);

  const sessionsDir = resolveSessionTranscriptsDir();
  await fs.mkdir(sessionsDir, { recursive: true });
  runtime.log(`Sessions OK: ${sessionsDir}`);
}
