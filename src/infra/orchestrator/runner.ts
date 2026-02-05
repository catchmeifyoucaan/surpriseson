import fs from "node:fs";
import path from "node:path";
import type { SurprisebotConfig } from "../../config/config.js";
import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { createSubsystemLogger } from "../../logging.js";
import { enqueueSystemEvent } from "../system-events.js";
import { requestHeartbeatNow } from "../heartbeat-wake.js";
import { resolveMainSessionKey } from "../../config/sessions.js";
import { dispatchIncidents } from "./dispatcher.js";
import { dispatchTasks } from "./task-dispatcher.js";
import { readIncidentBatch } from "./queue.js";

const log = createSubsystemLogger("gateway/orchestrator");

const HOURLY_MS = 60 * 60_000;
const DAILY_MS = 24 * 60 * 60_000;

function resolveWorkspaceDir(cfg: SurprisebotConfig): string {
  const agentId = resolveDefaultAgentId(cfg);
  return resolveAgentWorkspaceDir(cfg, agentId);
}

function resolveStatePaths(cfg: SurprisebotConfig) {
  const workspaceDir = resolveWorkspaceDir(cfg);
  const memoryDir = path.join(workspaceDir, "memory");
  return {
    workspaceDir,
    incidentsPath: path.join(memoryDir, "incidents.jsonl"),
    dispatchPath: path.join(memoryDir, "orchestrator.dispatch.jsonl"),
    statePath: path.join(memoryDir, "orchestrator.state.json"),
  };
}

type OrchestratorState = {
  lastHourlyTickAt?: number;
  lastDailyTickAt?: number;
  lastIncidentMtimeMs?: number;
  lastIncidentOffset?: number;
};

async function loadState(statePath: string): Promise<OrchestratorState> {
  try {
    const raw = await fs.promises.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as OrchestratorState;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

async function saveState(statePath: string, state: OrchestratorState) {
  await fs.promises.mkdir(path.dirname(statePath), { recursive: true });
  await fs.promises.writeFile(statePath, JSON.stringify(state, null, 2));
}

function msUntilNextHour(now: Date): number {
  const ms = now.getTime();
  return HOURLY_MS - (ms % HOURLY_MS);
}

function msUntilNextMidnight(now: Date): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1_000, next.getTime() - now.getTime());
}

async function hasIncidentUpdates(
  incidentsPath: string,
  state: OrchestratorState,
): Promise<{ updated: boolean; mtimeMs?: number }> {
  try {
    const stat = await fs.promises.stat(incidentsPath);
    const mtimeMs = stat.mtimeMs;
    const updated = !state.lastIncidentMtimeMs || mtimeMs > state.lastIncidentMtimeMs;
    return { updated, mtimeMs };
  } catch {
    return { updated: false };
  }
}

async function processIncidentQueue(params: {
  cfg: SurprisebotConfig;
  incidentsPath: string;
  dispatchPath: string;
  workspaceDir: string;
  state: OrchestratorState;
}) {
  const batch = await readIncidentBatch({
    incidentsPath: params.incidentsPath,
    offset: params.state.lastIncidentOffset,
  });
  if (batch.incidents.length > 0) {
    await dispatchIncidents({
      cfg: params.cfg,
      incidents: batch.incidents,
      workspaceDir: params.workspaceDir,
      dispatchPath: params.dispatchPath,
    });
  }
  await dispatchTasks({
    cfg: params.cfg,
    workspaceDir: params.workspaceDir,
    dispatchPath: path.join(params.workspaceDir, "memory", "orchestrator.tasks.jsonl"),
  });
  params.state.lastIncidentOffset = batch.nextOffset;
  if (batch.mtimeMs) params.state.lastIncidentMtimeMs = batch.mtimeMs;
}

async function triggerTick(params: {
  cfg: SurprisebotConfig;
  label: "hourly" | "daily";
  reason: string;
  state: OrchestratorState;
  incidentsPath: string;
  dispatchPath: string;
  statePath: string;
  workspaceDir: string;
}) {
  const sessionKey = resolveMainSessionKey(params.cfg);
  enqueueSystemEvent(`Orchestrator ${params.label} tick: review incident queue and act.`, {
    sessionKey,
    contextKey: `orchestrator:${params.label}`,
  });
  requestHeartbeatNow({ reason: params.reason, coalesceMs: 1_000 });

  await processIncidentQueue({
    cfg: params.cfg,
    incidentsPath: params.incidentsPath,
    dispatchPath: params.dispatchPath,
    workspaceDir: params.workspaceDir,
    state: params.state,
  });

  if (params.label === "hourly") {
    params.state.lastHourlyTickAt = Date.now();
  } else {
    params.state.lastDailyTickAt = Date.now();
  }

  const incidentState = await hasIncidentUpdates(params.incidentsPath, params.state);
  if (incidentState.mtimeMs) {
    params.state.lastIncidentMtimeMs = incidentState.mtimeMs;
  }
  await saveState(params.statePath, params.state);
}

export function startOrchestratorRunner(params: { cfg: SurprisebotConfig }) {
  const { cfg } = params;
  const { incidentsPath, statePath, dispatchPath, workspaceDir } = resolveStatePaths(cfg);

  const orchestrator = cfg.agents?.defaults?.orchestrator;
  const enabled = orchestrator?.enabled ?? true;
  if (!enabled) {
    log.info("orchestrator runner disabled (enabled=false)");
    return { stop: () => {} };
  }

  let stopped = false;
  let hourlyTimer: ReturnType<typeof setInterval> | null = null;
  let dailyTimer: ReturnType<typeof setInterval> | null = null;
  let hourlyTimeout: ReturnType<typeof setTimeout> | null = null;
  let dailyTimeout: ReturnType<typeof setTimeout> | null = null;

  const statePromise = loadState(statePath);

  const scheduleHourly = async () => {
    if (stopped) return;
    const state = await statePromise;
    const { updated, mtimeMs } = await hasIncidentUpdates(incidentsPath, state);
    if (updated) {
      await triggerTick({
        cfg,
        label: "hourly",
        reason: "orchestrator:hourly",
        state,
        incidentsPath,
        dispatchPath,
        statePath,
        workspaceDir,
      });
    } else {
      state.lastHourlyTickAt = Date.now();
      if (mtimeMs) state.lastIncidentMtimeMs = mtimeMs;
      await saveState(statePath, state);
    }
  };

  const scheduleDaily = async () => {
    if (stopped) return;
    const state = await statePromise;
    await triggerTick({
      cfg,
      label: "daily",
      reason: "orchestrator:daily",
      state,
      incidentsPath,
      dispatchPath,
      statePath,
      workspaceDir,
    });
  };

  const startAlignedTimers = () => {
    hourlyTimeout = setTimeout(() => {
      void scheduleHourly().catch(() => {});
      hourlyTimer = setInterval(() => {
        void scheduleHourly().catch(() => {});
      }, HOURLY_MS);
      hourlyTimer.unref?.();
    }, msUntilNextHour(new Date()));

    dailyTimeout = setTimeout(() => {
      void scheduleDaily().catch(() => {});
      dailyTimer = setInterval(() => {
        void scheduleDaily().catch(() => {});
      }, DAILY_MS);
      dailyTimer.unref?.();
    }, msUntilNextMidnight(new Date()));
  };

  startAlignedTimers();
  log.info("orchestrator runner started (hourly + daily)");

  const stop = () => {
    stopped = true;
    if (hourlyTimeout) clearTimeout(hourlyTimeout);
    if (dailyTimeout) clearTimeout(dailyTimeout);
    if (hourlyTimer) clearInterval(hourlyTimer);
    if (dailyTimer) clearInterval(dailyTimer);
    hourlyTimeout = null;
    dailyTimeout = null;
    hourlyTimer = null;
    dailyTimer = null;
  };

  return { stop };
}
