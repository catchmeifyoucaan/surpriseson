import type { SurprisebotConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging.js";
import { refreshReconStatus } from "./recon-status.js";

const log = createSubsystemLogger("gateway/recon-status");
const DEFAULT_INTERVAL_MINUTES = 5;

function resolveIntervalMs(cfg: SurprisebotConfig): number {
  const minutes = cfg.agents?.defaults?.reconStatus?.intervalMinutes;
  const value = typeof minutes === "number" && Number.isFinite(minutes) ? minutes : DEFAULT_INTERVAL_MINUTES;
  return Math.max(1, value) * 60_000;
}

export function startReconStatusRunner(cfg: SurprisebotConfig) {
  const intervalMs = resolveIntervalMs(cfg);
  const timer = setInterval(() => {
    void refreshReconStatus(cfg).catch((err) => {
      log.warn(`recon status refresh failed: ${String(err)}`);
    });
  }, intervalMs);
  timer.unref?.();
  log.info(`recon status refresher started (${Math.round(intervalMs / 60000)}m)`);

  // immediate check on startup
  void refreshReconStatus(cfg).catch((err) => {
    log.warn(`recon status refresh failed: ${String(err)}`);
  });

  return { stop: () => clearInterval(timer) };
}
