import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import type { SurprisebotConfig } from "../../config/config.js";
import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { createSubsystemLogger } from "../../logging.js";
import { resolveMissionControlPaths } from "./ledger.js";

const log = createSubsystemLogger("gateway/mission-control-maintenance");

export type MissionControlDuplicatePruneResult = {
  incidentsDropped: number;
  tasksDropped: number;
  activitiesDropped: number;
  subscriptionsDropped: number;
};

function resolveWorkspaceDir(cfg: SurprisebotConfig): string {
  const agentId = resolveDefaultAgentId(cfg);
  return resolveAgentWorkspaceDir(cfg, agentId);
}

function extractUrl(incident: Record<string, unknown>): string {
  const meta = incident.meta && typeof incident.meta === "object" ? (incident.meta as Record<string, unknown>) : {};
  const metaUrl = meta.url;
  if (typeof metaUrl === "string" && metaUrl.trim()) return metaUrl.trim();
  const evidence = Array.isArray(incident.evidence) ? incident.evidence : [];
  for (const line of evidence) {
    if (typeof line !== "string") continue;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.toLowerCase().startsWith("url:")) return trimmed.slice(4).trim();
    if (trimmed.toLowerCase().startsWith("http://") || trimmed.toLowerCase().startsWith("https://")) return trimmed;
  }
  return "";
}

function extractPath(incident: Record<string, unknown>): string {
  const meta = incident.meta && typeof incident.meta === "object" ? (incident.meta as Record<string, unknown>) : {};
  const metaPath = meta.path;
  return typeof metaPath === "string" ? metaPath.trim() : "";
}

function incidentKey(incident: Record<string, unknown>): string | null {
  const source = typeof incident.source === "string" ? incident.source.trim() : "";
  if (!source || (source !== "research" && source !== "exposure")) return null;
  const summary = typeof incident.summary === "string" ? incident.summary.trim() : "";
  if (!summary) return null;
  const url = extractUrl(incident).toLowerCase();
  const filePath = extractPath(incident).toLowerCase();
  return `${source.toLowerCase()}|${summary.toLowerCase()}|${url}|${filePath}`;
}

async function rewriteJsonl(params: {
  inputPath: string;
  decide: (record: Record<string, unknown>) => { keep: boolean; id?: string | null };
}): Promise<{ kept: number; dropped: number; droppedIds: Set<string> } | null> {
  try {
    await fs.stat(params.inputPath);
  } catch {
    return null;
  }

  const tmpPath = `${params.inputPath}.tmp`;
  const droppedIds = new Set<string>();
  let kept = 0;
  let dropped = 0;

  const handle = await fs.open(params.inputPath, "r");
  const stream = handle.createReadStream({ encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const out = await fs.open(tmpPath, "w");

  for await (const line of rl) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as Record<string, unknown>;
      const decision = params.decide(record);
      if (decision.keep) {
        await out.write(`${trimmed}\n`);
        kept += 1;
      } else {
        dropped += 1;
        if (decision.id) droppedIds.add(decision.id);
      }
    } catch {
      await out.write(`${trimmed}\n`);
      kept += 1;
    }
  }

  await out.close();
  await handle.close();

  if (dropped > 0) {
    await fs.rename(tmpPath, params.inputPath);
  } else {
    await fs.rm(tmpPath, { force: true });
  }

  return { kept, dropped, droppedIds };
}

export async function pruneMissionControlDuplicates(
  cfg: SurprisebotConfig,
): Promise<MissionControlDuplicatePruneResult> {
  const workspaceDir = resolveWorkspaceDir(cfg);
  const incidentsPath = path.join(workspaceDir, "memory", "incidents.jsonl");
  const missionControl = resolveMissionControlPaths(cfg);

  const seen = new Set<string>();
  const incidentResult = await rewriteJsonl({
    inputPath: incidentsPath,
    decide: (record) => {
      const key = incidentKey(record);
      if (!key) return { keep: true, id: null };
      if (seen.has(key)) {
        const id = typeof record.id === "string" ? record.id : null;
        return { keep: false, id };
      }
      seen.add(key);
      return { keep: true, id: null };
    },
  });

  const droppedIncidentIds = incidentResult?.droppedIds ?? new Set<string>();
  const droppedIncidentCount = incidentResult?.dropped ?? 0;

  const taskResult = await rewriteJsonl({
    inputPath: missionControl.files.tasks,
    decide: (record) => {
      const meta = record.meta && typeof record.meta === "object" ? (record.meta as Record<string, unknown>) : {};
      const incidentId = meta.incidentId;
      if (typeof incidentId === "string" && droppedIncidentIds.has(incidentId)) {
        const id = typeof record.id === "string" ? record.id : null;
        return { keep: false, id };
      }
      return { keep: true, id: null };
    },
  });

  const removedTaskIds = taskResult?.droppedIds ?? new Set<string>();
  const droppedTaskCount = taskResult?.dropped ?? 0;

  const activityResult = await rewriteJsonl({
    inputPath: missionControl.files.activities,
    decide: (record) => {
      const taskId = record.taskId;
      if (typeof taskId === "string" && removedTaskIds.has(taskId)) {
        return { keep: false, id: null };
      }
      return { keep: true, id: null };
    },
  });

  const subscriptionResult = await rewriteJsonl({
    inputPath: missionControl.files.subscriptions,
    decide: (record) => {
      const taskId = record.taskId;
      if (typeof taskId === "string" && removedTaskIds.has(taskId)) {
        return { keep: false, id: null };
      }
      return { keep: true, id: null };
    },
  });

  if (droppedIncidentCount || droppedTaskCount || (activityResult?.dropped ?? 0) || (subscriptionResult?.dropped ?? 0)) {
    log.info("mission control duplicate prune", {
      incidentsDropped: droppedIncidentCount,
      tasksDropped: droppedTaskCount,
      activitiesDropped: activityResult?.dropped ?? 0,
      subscriptionsDropped: subscriptionResult?.dropped ?? 0,
    });
  }

  return {
    incidentsDropped: droppedIncidentCount,
    tasksDropped: droppedTaskCount,
    activitiesDropped: activityResult?.dropped ?? 0,
    subscriptionsDropped: subscriptionResult?.dropped ?? 0,
  };
}
