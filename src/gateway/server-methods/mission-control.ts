import fs from "node:fs/promises";
import path from "node:path";

import { loadConfig } from "../../config/config.js";
import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { resolveMainSessionKey } from "../../config/sessions.js";
import {
  listTasks,
  listActivities,
  listMessages,
  listDocuments,
  listSubscriptions,
  listNotifications,
  countTasks,
  countActivities,
  getTask,
  updateTask,
} from "../../infra/mission-control/db.js";
import {
  readMissionControlRecords,
  resolveMissionControlDir,
  type BudgetLedgerRecord,
  type RunLedgerRecord,
} from "../../infra/mission-control/ledger.js";
import { addTaskActivity, addTaskSubscription, updateTaskStatus } from "../../infra/mission-control/tasks.js";
import { enqueueSystemEvent } from "../../infra/system-events.js";
import { requestHeartbeatNow } from "../../infra/heartbeat-wake.js";
import type { IncidentRecord } from "../../infra/incidents.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const DEFAULT_MAX_BYTES = 512_000;

function clampLimit(value: number | undefined, fallback = DEFAULT_LIMIT) {
  const raw = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.max(1, Math.min(MAX_LIMIT, raw));
}

function clampOffset(value: number | undefined) {
  const raw = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, raw);
}


function resolveWorkspaceDir(cfg: ReturnType<typeof loadConfig>): string {
  const agentId = resolveDefaultAgentId(cfg);
  return resolveAgentWorkspaceDir(cfg, agentId);
}

async function readJsonlTail<T = Record<string, unknown>>(
  filePath: string,
  limit: number,
  maxBytes = DEFAULT_MAX_BYTES,
): Promise<T[]> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat) return [];
  const size = stat.size;
  const start = Math.max(0, size - maxBytes);
  const handle = await fs.open(filePath, "r");
  try {
    const length = Math.max(0, size - start);
    const buffer = Buffer.alloc(length);
    const readResult = await handle.read(buffer, 0, length, start);
    const text = buffer.toString("utf8", 0, readResult.bytesRead);
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const sliced = lines.slice(-limit);
    const records: T[] = [];
    for (const line of sliced) {
      try {
        records.push(JSON.parse(line) as T);
      } catch {
        // ignore
      }
    }
    return records;
  } finally {
    await handle.close();
  }
}

async function readIncidents(cfg: ReturnType<typeof loadConfig>, limit: number): Promise<IncidentRecord[]> {
  const workspaceDir = resolveWorkspaceDir(cfg);
  const filePath = path.join(workspaceDir, "memory", "incidents.jsonl");
  return await readJsonlTail<IncidentRecord>(filePath, limit);
}

async function readRollupState(cfg: ReturnType<typeof loadConfig>) {
  const dir = resolveMissionControlDir(cfg);
  const statePath = path.join(dir, "rollups", "rollup.state.json");
  try {
    const raw = await fs.readFile(statePath, "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const missionControlHandlers: GatewayRequestHandlers = {
  "mission-control.snapshot": async ({ params, respond }) => {
    const cfg = loadConfig();
    const input = params as {
      limit?: number;
      tasks?: { limit?: number; offset?: number };
      activities?: { limit?: number; offset?: number };
      messages?: { limit?: number; offset?: number };
      documents?: { limit?: number; offset?: number };
      subscriptions?: { limit?: number; offset?: number };
      notifications?: { limit?: number; offset?: number };
      incidents?: { limit?: number };
      ledger?: { limit?: number };
    };
    const baseLimit = clampLimit(input?.limit);
    const tasksLimit = clampLimit(input?.tasks?.limit ?? baseLimit);
    const tasksOffset = clampOffset(input?.tasks?.offset ?? 0);
    const activitiesLimit = clampLimit(input?.activities?.limit ?? baseLimit);
    const activitiesOffset = clampOffset(input?.activities?.offset ?? 0);
    const messagesLimit = clampLimit(input?.messages?.limit ?? baseLimit);
    const messagesOffset = clampOffset(input?.messages?.offset ?? 0);
    const documentsLimit = clampLimit(input?.documents?.limit ?? baseLimit);
    const documentsOffset = clampOffset(input?.documents?.offset ?? 0);
    const subscriptionsLimit = clampLimit(input?.subscriptions?.limit ?? baseLimit);
    const subscriptionsOffset = clampOffset(input?.subscriptions?.offset ?? 0);
    const notificationsLimit = clampLimit(input?.notifications?.limit ?? baseLimit);
    const notificationsOffset = clampOffset(input?.notifications?.offset ?? 0);
    const ledgerLimit = clampLimit(input?.ledger?.limit ?? baseLimit);
    const incidentsLimit = clampLimit(input?.incidents?.limit ?? baseLimit);

    try {
      const [
        runLedger,
        budgetLedger,
        incidents,
        rollupState,
      ] = await Promise.all([
        readMissionControlRecords<RunLedgerRecord>({ cfg, kind: "run-ledger", limit: ledgerLimit }),
        readMissionControlRecords<BudgetLedgerRecord>({ cfg, kind: "budget-ledger", limit: ledgerLimit }),
        readIncidents(cfg, incidentsLimit),
        readRollupState(cfg),
      ]);

      const payload = {
        generatedAt: new Date().toISOString(),
        tasks: listTasks(cfg, { limit: tasksLimit, offset: tasksOffset }),
        activities: listActivities(cfg, { limit: activitiesLimit, offset: activitiesOffset }),
        messages: listMessages(cfg, { limit: messagesLimit, offset: messagesOffset }),
        documents: listDocuments(cfg, { limit: documentsLimit, offset: documentsOffset }),
        subscriptions: listSubscriptions(cfg, { limit: subscriptionsLimit, offset: subscriptionsOffset }),
        notifications: listNotifications(cfg, { limit: notificationsLimit, offset: notificationsOffset }),
        runLedger,
        budgetLedger,
        incidents,
        rollupState,
        pageInfo: {
          tasks: {
            limit: tasksLimit,
            offset: tasksOffset,
            total: countTasks(cfg),
          },
          activities: {
            limit: activitiesLimit,
            offset: activitiesOffset,
            total: countActivities(cfg),
          },
        },
        config: {
          missionControl: cfg.missionControl ?? null,
          budgets: cfg.budgets ?? null,
        },
      };
      respond(true, payload, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, `mission control snapshot failed: ${String(err)}`));
    }
  },
  "mission-control.task.update": async ({ params, respond }) => {
    const cfg = loadConfig();
    const id = (params as { id?: unknown }).id;
    const patch = (params as { patch?: unknown }).patch;
    if (typeof id !== "string" || !id.trim()) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "task id required"));
      return;
    }
    if (!patch || typeof patch !== "object") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "patch object required"));
      return;
    }
    const current = getTask(cfg, id);
    if (!current) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "task not found"));
      return;
    }

    const nextPatch = patch as Record<string, unknown>;
    const status = typeof nextPatch.status === "string" ? nextPatch.status : null;
    const title = typeof nextPatch.title === "string" ? nextPatch.title : undefined;
    const description = typeof nextPatch.description === "string" ? nextPatch.description : undefined;
    const priority = typeof nextPatch.priority === "string" ? nextPatch.priority : undefined;
    const trustTier = typeof nextPatch.trustTier === "string" ? nextPatch.trustTier : undefined;
    const assignees = Array.isArray(nextPatch.assignees)
      ? nextPatch.assignees.filter((value) => typeof value === "string") as string[]
      : undefined;
    const labels = Array.isArray(nextPatch.labels)
      ? nextPatch.labels.filter((value) => typeof value === "string") as string[]
      : undefined;

    if (status && status !== current.status) {
      updateTaskStatus(cfg, id, status as any);
    }

    const nonStatusPatch: Record<string, unknown> = {};
    if (title !== undefined) nonStatusPatch.title = title;
    if (description !== undefined) nonStatusPatch.description = description;
    if (priority !== undefined) nonStatusPatch.priority = priority;
    if (trustTier !== undefined) nonStatusPatch.trustTier = trustTier;
    if (assignees !== undefined) nonStatusPatch.assignees = assignees;
    if (labels !== undefined) nonStatusPatch.labels = labels;

    if (Object.keys(nonStatusPatch).length > 0) {
      updateTask(cfg, id, nonStatusPatch as any);
    }

    if (assignees && assignees.length) {
      const existing = new Set(current.assignees ?? []);
      for (const agentId of assignees) {
        if (existing.has(agentId)) continue;
        addTaskSubscription(cfg, id, agentId, "assigned");
      }
    }

    addTaskActivity(cfg, {
      taskId: id,
      type: "task_updated",
      message: "Task updated from Mission Control",
      meta: { patch: nonStatusPatch, status },
    });

    respond(true, { ok: true }, undefined);
  },
  "mission-control.task.qa": async ({ params, respond }) => {
    const cfg = loadConfig();
    const id = (params as { id?: unknown }).id;
    const action = (params as { action?: unknown }).action;
    if (typeof id !== "string" || !id.trim()) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "task id required"));
      return;
    }
    if (action !== "approve" && action !== "deny") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "action must be approve or deny"));
      return;
    }
    const task = getTask(cfg, id);
    if (!task) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "task not found"));
      return;
    }
    const nextStatus = action === "approve" ? "verified" : "blocked";
    updateTaskStatus(cfg, id, nextStatus);
    addTaskActivity(cfg, {
      taskId: id,
      type: action === "approve" ? "qa_approve" : "qa_deny",
      message: `QA ${action} via Mission Control`,
    });
    respond(true, { ok: true, status: nextStatus }, undefined);
  },
  "mission-control.task.requeue": async ({ params, respond }) => {
    const cfg = loadConfig();
    const id = (params as { id?: unknown }).id;
    if (typeof id !== "string" || !id.trim()) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "task id required"));
      return;
    }
    const task = getTask(cfg, id);
    if (!task) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "task not found"));
      return;
    }
    const sessionKey = resolveMainSessionKey(cfg);
    enqueueSystemEvent(`Requeue task: ${task.title}`, {
      sessionKey,
      contextKey: `task:${id}`,
    });
    requestHeartbeatNow({ reason: `mission-control:requeue:${id}`, coalesceMs: 1_000 });
    addTaskActivity(cfg, {
      taskId: id,
      type: "task_requeued",
      message: "Task requeued from Mission Control",
    });
    respond(true, { ok: true }, undefined);
  },
};
