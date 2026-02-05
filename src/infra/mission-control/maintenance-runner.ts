import type { SurprisebotConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging.js";
import { pruneMissionControlDuplicates } from "./maintenance.js";

const log = createSubsystemLogger("gateway/mission-control-maintenance");
const DEFAULT_INTERVAL_MINUTES = 1440;

function resolveMaintenanceConfig(cfg: SurprisebotConfig) {
  const maintenance = cfg.missionControl?.maintenance;
  return {
    enabled: maintenance?.enabled !== false,
    intervalMinutes: maintenance?.intervalMinutes,
  };
}

function resolveIntervalMs(cfg: SurprisebotConfig): number {
  const minutes = resolveMaintenanceConfig(cfg).intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
  const safe = Number.isFinite(minutes) ? Math.max(15, minutes) : DEFAULT_INTERVAL_MINUTES;
  return safe * 60_000;
}

export function startMissionControlMaintenanceRunner(cfg: SurprisebotConfig) {
  const { enabled } = resolveMaintenanceConfig(cfg);
  if (!enabled) {
    log.info("mission control maintenance disabled by config");
    return { stop: () => {} };
  }

  const intervalMs = resolveIntervalMs(cfg);

  const runOnce = async () => {
    const maintenance = resolveMaintenanceConfig(cfg);
    if (!maintenance.enabled) return;
    const result = await pruneMissionControlDuplicates(cfg);
    if (
      result.incidentsDropped ||
      result.tasksDropped ||
      result.activitiesDropped ||
      result.subscriptionsDropped
    ) {
      log.info("mission control maintenance pruned duplicates", result);
    }
  };

  void runOnce().catch((err) => {
    log.warn(`mission control maintenance failed: ${String(err)}`);
  });

  const timer = setInterval(() => {
    void runOnce().catch((err) => {
      log.warn(`mission control maintenance failed: ${String(err)}`);
    });
  }, intervalMs);
  timer.unref?.();

  log.info(`mission control maintenance runner started (${Math.round(intervalMs / 60000)}m)`);

  return { stop: () => clearInterval(timer) };
}
