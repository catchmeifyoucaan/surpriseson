import fs from "node:fs/promises";
import path from "node:path";

import type { SurprisebotConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging.js";
import { resolveMissionControlPaths } from "./ledger.js";
import { rollupMissionControlLedgers } from "./rollup.js";
import { pruneMissionControlDuplicates } from "./maintenance.js";

const log = createSubsystemLogger("gateway/mission-control-rollup");
const DEFAULT_INTERVAL_MINUTES = 360;

function resolveRollupConfig(cfg: SurprisebotConfig) {
  const rollup = cfg.missionControl?.rollup;
  return {
    enabled: rollup?.enabled !== false,
    keepDays: rollup?.keepDays,
    minBytes: rollup?.minBytes,
    intervalMinutes: rollup?.intervalMinutes,
  };
}

function resolveIntervalMs(cfg: SurprisebotConfig): number {
  const minutes = resolveRollupConfig(cfg).intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
  const safe = Number.isFinite(minutes) ? Math.max(15, minutes) : DEFAULT_INTERVAL_MINUTES;
  return safe * 60_000;
}

function resolveStatePath(cfg: SurprisebotConfig): string {
  const { dir } = resolveMissionControlPaths(cfg);
  return path.join(dir, "rollups", "rollup.state.json");
}

type RollupState = {
  lastRunDate?: string;
  lastRunAt?: string;
};

async function loadState(statePath: string): Promise<RollupState> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as RollupState;
  } catch {
    return {};
  }
}

async function saveState(statePath: string, state: RollupState): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}

function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function startMissionControlRollupRunner(cfg: SurprisebotConfig) {
  const { enabled } = resolveRollupConfig(cfg);
  if (!enabled) {
    log.info("mission control rollup disabled by config");
    return { stop: () => {} };
  }

  const intervalMs = resolveIntervalMs(cfg);
  const statePath = resolveStatePath(cfg);

  const runIfDue = async () => {
    const rollupCfg = resolveRollupConfig(cfg);
    if (!rollupCfg.enabled) return;
    const state = await loadState(statePath);
    const today = todayKey();
    if (state.lastRunDate === today) return;

    await rollupMissionControlLedgers(cfg, {
      keepDays: rollupCfg.keepDays,
      minBytes: rollupCfg.minBytes,
    });

    await pruneMissionControlDuplicates(cfg);

    await saveState(statePath, {
      lastRunDate: today,
      lastRunAt: new Date().toISOString(),
    });
  };

  void runIfDue().catch((err) => {
    log.warn(`mission control rollup failed: ${String(err)}`);
  });

  const timer = setInterval(() => {
    void runIfDue().catch((err) => {
      log.warn(`mission control rollup failed: ${String(err)}`);
    });
  }, intervalMs);
  timer.unref?.();

  log.info(`mission control rollup runner started (${Math.round(intervalMs / 60000)}m)`);

  return { stop: () => clearInterval(timer) };
}
