import fs from "node:fs/promises";
import path from "node:path";

import type { SurprisebotConfig } from "../config/config.js";
import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { loadSubagentRegistryFromDisk } from "../agents/subagent-registry.store.js";
import { createSubsystemLogger } from "../logging.js";
import { syncActiveMemoryRunningJobs, type RunningJobSpec } from "./active-memory.js";

const log = createSubsystemLogger("gateway/active-memory");
const DEFAULT_INTERVAL_MINUTES = 1;

function resolveWorkspaceDir(cfg: SurprisebotConfig): string {
  const agentId = resolveDefaultAgentId(cfg);
  return resolveAgentWorkspaceDir(cfg, agentId);
}

function resolveIntervalMs(cfg: SurprisebotConfig): number {
  const defaults = cfg.agents?.defaults as { activeMemory?: { intervalMinutes?: number } } | undefined;
  const minutes = defaults?.activeMemory?.intervalMinutes;
  const value = typeof minutes === "number" && Number.isFinite(minutes) ? minutes : DEFAULT_INTERVAL_MINUTES;
  return Math.max(1, Math.floor(value)) * 60_000;
}

async function readReconStatus(workspaceDir: string): Promise<{ running: boolean; pid?: number; logPath?: string } | null> {
  const statusPath = path.join(workspaceDir, "recon", "status.json");
  try {
    const raw = await fs.readFile(statusPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return null;
    const running = Boolean(parsed.running);
    const pid = typeof parsed.pid === "number" ? parsed.pid : undefined;
    const logPath = typeof parsed.logPath === "string" ? parsed.logPath : undefined;
    return { running, pid, logPath };
  } catch {
    return null;
  }
}

function extractAgentId(childSessionKey?: string): string | undefined {
  if (!childSessionKey) return undefined;
  const match = childSessionKey.match(/^agent:([^:]+):/);
  return match ? match[1] : undefined;
}

async function refreshActiveMemory(cfg: SurprisebotConfig) {
  const workspaceDir = resolveWorkspaceDir(cfg);
  const jobs: RunningJobSpec[] = [];

  const reconStatus = await readReconStatus(workspaceDir);
  if (reconStatus?.running) {
    jobs.push({ kind: "recon", pid: reconStatus.pid, logPath: reconStatus.logPath });
  }

  const subagentRuns = loadSubagentRegistryFromDisk();
  const activeRuns = [...subagentRuns.values()].filter((entry) => !entry.endedAt);
  activeRuns.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
  for (const entry of activeRuns) {
    jobs.push({
      kind: "subagent",
      agentId: extractAgentId(entry.childSessionKey),
      label: entry.label,
      runId: entry.runId,
      task: entry.task,
    });
  }

  await syncActiveMemoryRunningJobs({ workspaceDir, jobs });
}

export function startActiveMemoryRunner(cfg: SurprisebotConfig) {
  const intervalMs = resolveIntervalMs(cfg);
  const timer = setInterval(() => {
    void refreshActiveMemory(cfg).catch((err) => {
      log.warn(`active memory refresh failed: ${String(err)}`);
    });
  }, intervalMs);
  timer.unref?.();
  log.info(`active memory refresher started (${Math.round(intervalMs / 60000)}m)`);

  void refreshActiveMemory(cfg).catch((err) => {
    log.warn(`active memory refresh failed: ${String(err)}`);
  });

  return { stop: () => clearInterval(timer) };
}
