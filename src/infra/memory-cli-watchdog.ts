import type { SurprisebotConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging.js";
import { runExec } from "../process/exec.js";

const log = createSubsystemLogger("gateway/memory-cli-watchdog");

const DEFAULT_INTERVAL_MINUTES = 5;
const DEFAULT_STATUS_MAX_AGE_SEC = 120;
const DEFAULT_SEARCH_MAX_AGE_SEC = 180;
const DEFAULT_INDEX_MAX_AGE_SEC = 3600;
const DEFAULT_OTHER_MAX_AGE_SEC = 600;

const MEMORY_CMD_RE = /\bsurprisebot\b.*\bmemory\b/;

type MemoryCliProcess = {
  pid: number;
  ageSec: number;
  args: string;
  subcommand: "status" | "search" | "index" | "other";
};

type WatchdogConfig = {
  enabled: boolean;
  intervalMinutes: number;
  maxStatusAgeSeconds: number;
  maxSearchAgeSeconds: number;
  maxIndexAgeSeconds: number;
  maxOtherAgeSeconds: number;
};

function resolveNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return value;
}

function normalizeMaxAge(value: unknown, fallback: number): number {
  const resolved = resolveNumber(value, fallback);
  if (resolved <= 0) return Number.POSITIVE_INFINITY;
  return Math.floor(resolved);
}

function resolveConfig(cfg: SurprisebotConfig): WatchdogConfig {
  const defaults = (cfg.agents?.defaults as { memoryCliWatchdog?: Record<string, unknown> } | undefined)
    ?.memoryCliWatchdog ?? {};
  const enabled =
    typeof defaults.enabled === "boolean" ? defaults.enabled : true;
  const intervalMinutes = Math.max(
    1,
    Math.floor(resolveNumber(defaults.intervalMinutes, DEFAULT_INTERVAL_MINUTES)),
  );
  return {
    enabled,
    intervalMinutes,
    maxStatusAgeSeconds: normalizeMaxAge(defaults.maxStatusAgeSeconds, DEFAULT_STATUS_MAX_AGE_SEC),
    maxSearchAgeSeconds: normalizeMaxAge(defaults.maxSearchAgeSeconds, DEFAULT_SEARCH_MAX_AGE_SEC),
    maxIndexAgeSeconds: normalizeMaxAge(defaults.maxIndexAgeSeconds, DEFAULT_INDEX_MAX_AGE_SEC),
    maxOtherAgeSeconds: normalizeMaxAge(defaults.maxOtherAgeSeconds, DEFAULT_OTHER_MAX_AGE_SEC),
  };
}

function parsePsOutput(stdout: string): MemoryCliProcess[] {
  const lines = stdout.split("\n").filter(Boolean);
  if (lines.length <= 1) return [];
  return lines
    .slice(1)
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => {
      const pid = Number(match[1]);
      const ageSec = Number(match[2]);
      const args = match[3];
      let subcommand: MemoryCliProcess["subcommand"] = "other";
      if (/\bmemory\s+status\b/.test(args)) subcommand = "status";
      else if (/\bmemory\s+search\b/.test(args)) subcommand = "search";
      else if (/\bmemory\s+index\b/.test(args)) subcommand = "index";
      return { pid, ageSec, args, subcommand };
    })
    .filter((entry) => Number.isFinite(entry.pid) && Number.isFinite(entry.ageSec))
    .filter((entry) => MEMORY_CMD_RE.test(entry.args));
}

function resolveMaxAgeSec(
  subcommand: MemoryCliProcess["subcommand"],
  cfg: WatchdogConfig,
): number {
  if (subcommand === "status") return cfg.maxStatusAgeSeconds;
  if (subcommand === "search") return cfg.maxSearchAgeSeconds;
  if (subcommand === "index") return cfg.maxIndexAgeSeconds;
  return cfg.maxOtherAgeSeconds;
}

async function sweepOnce(cfg: WatchdogConfig): Promise<void> {
  const { stdout } = await runExec("ps", ["-eo", "pid,etimes,args"], { timeoutMs: 3000 });
  const matches = parsePsOutput(stdout);
  if (matches.length === 0) return;

  for (const entry of matches) {
    const maxAge = resolveMaxAgeSec(entry.subcommand, cfg);
    if (!Number.isFinite(maxAge)) continue;
    if (entry.ageSec <= maxAge) continue;
    try {
      process.kill(entry.pid, "SIGKILL");
      log.warn(
        `killed stale memory cli pid=${entry.pid} age=${entry.ageSec}s cmd=${entry.subcommand}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(`failed to kill memory cli pid=${entry.pid}: ${msg}`);
    }
  }
}

export function startMemoryCliWatchdog(_cfg: SurprisebotConfig) {
  const cfg = resolveConfig(_cfg);
  if (!cfg.enabled) {
    log.info("memory cli watchdog disabled");
    return { stop: () => {} };
  }
  const intervalMs = cfg.intervalMinutes * 60_000;
  const timer = setInterval(() => {
    void sweepOnce(cfg).catch((err) => {
      log.warn(`memory cli watchdog sweep failed: ${String(err)}`);
    });
  }, intervalMs);
  timer.unref?.();
  log.info(`memory cli watchdog started (${Math.round(intervalMs / 60000)}m)`);

  void sweepOnce(cfg).catch((err) => {
    log.warn(`memory cli watchdog sweep failed: ${String(err)}`);
  });

  return { stop: () => clearInterval(timer) };
}
