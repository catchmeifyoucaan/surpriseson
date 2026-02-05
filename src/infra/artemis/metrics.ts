import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import type { SurprisebotConfig } from "../../config/config.js";
import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { createSubsystemLogger } from "../../logging.js";
import { appendMissionControlRecord } from "../mission-control/ledger.js";
import { listTasksByRunId, type MissionControlTaskRecord } from "../mission-control/db.js";

export type ArtemisMetrics = {
  runId: string;
  source: string;
  totalTasks: number;
  verified: number;
  falsePositives: number;
  sampleSize: number;
  precision: number;
  calculatedAt: string;
};

const log = createSubsystemLogger("gateway/artemis-metrics");

function resolveWorkspaceDir(cfg: SurprisebotConfig): string {
  const agentId = resolveDefaultAgentId(cfg);
  return resolveAgentWorkspaceDir(cfg, agentId);
}

function resolveMetricsPath(cfg: SurprisebotConfig): string {
  const workspace = resolveWorkspaceDir(cfg);
  return path.join(workspace, "memory", "artemis.metrics.json");
}

function computeMetrics(tasks: MissionControlTaskRecord[], runId: string, source: string): ArtemisMetrics {
  const total = tasks.length;
  const verified = tasks.filter((task) => task.status === "verified" || task.status === "done").length;
  const falsePositives = tasks.filter((task) => task.status === "cancelled").length;
  const sampleSize = verified + falsePositives;
  const precision = sampleSize > 0 ? verified / sampleSize : 0;
  return {
    runId,
    source,
    totalTasks: total,
    verified,
    falsePositives,
    sampleSize,
    precision,
    calculatedAt: new Date().toISOString(),
  };
}

export async function recordArtemisMetrics(params: {
  cfg: SurprisebotConfig;
  runId: string;
  source: string;
}) {
  const tasks = listTasksByRunId(params.cfg, params.runId).filter((task) => {
    if (!task.source) return true;
    return String(task.source).startsWith("artemis");
  });
  const metrics = computeMetrics(tasks, params.runId, params.source);
  const payload = {
    id: `signal-${crypto.randomUUID()}`,
    ts: new Date().toISOString(),
    source: "system",
    version: 1,
    kind: "artemis_metrics",
    category: "quality",
    meta: metrics,
  };

  try {
    await appendMissionControlRecord({
      cfg: params.cfg,
      kind: "signals",
      record: payload as any,
    });
  } catch (err) {
    log.warn(`failed to append artemis metrics signal: ${String(err)}`);
  }

  await saveLatestMetrics(params.cfg, metrics);
  return metrics;
}

async function saveLatestMetrics(cfg: SurprisebotConfig, metrics: ArtemisMetrics) {
  const pathOut = resolveMetricsPath(cfg);
  const current = await loadLatestMetricsFile(cfg);
  const key = metrics.source === "artemis-cert" ? "cert" : "stanford";
  const next = {
    ...current,
    [key]: metrics,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(pathOut), { recursive: true });
  await fs.writeFile(pathOut, JSON.stringify(next, null, 2));
}

async function loadLatestMetricsFile(cfg: SurprisebotConfig): Promise<Record<string, unknown>> {
  const pathIn = resolveMetricsPath(cfg);
  try {
    const raw = await fs.readFile(pathIn, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function loadLatestArtemisMetrics(cfg: SurprisebotConfig, source: string): Promise<ArtemisMetrics | null> {
  const raw = await loadLatestMetricsFile(cfg);
  const key = source === "artemis-cert" ? "cert" : "stanford";
  const value = raw[key];
  if (!value || typeof value !== "object") return null;
  return value as ArtemisMetrics;
}
