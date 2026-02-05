import crypto from "node:crypto";

import type { SurprisebotConfig } from "../../config/config.js";
import { resolveMainSessionKey } from "../../config/sessions.js";
import { appendMissionControlRecord } from "./ledger.js";
import { enqueueSystemEvent } from "../system-events.js";
import { requestHeartbeatNow } from "../heartbeat-wake.js";
import { recordArtemisMetrics } from "../artemis/metrics.js";
import {
  computeFingerprint,
  insertActivity,
  insertDocument,
  insertMessage,
  insertNotification,
  insertSubscription,
  insertTask,
  updateTask,
  getTask,
  type MissionControlActivityRecord,
  type MissionControlDocumentRecord,
  type MissionControlMessageRecord,
  type MissionControlNotificationRecord,
  type MissionControlTaskPriority,
  type MissionControlTaskRecord,
  type MissionControlTaskStatus,
  type MissionControlTrustTier,
} from "./db.js";

export type MissionControlTaskCreate = {
  title: string;
  description?: string | null;
  status?: MissionControlTaskStatus;
  priority?: MissionControlTaskPriority;
  source?: string | null;
  severity?: "low" | "medium" | "high" | null;
  trustTier?: MissionControlTrustTier | null;
  fingerprint?: string | null;
  assignees?: string[];
  labels?: string[];
  parentTaskId?: string | null;
  meta?: Record<string, unknown>;
};

export function createTask(cfg: SurprisebotConfig, input: MissionControlTaskCreate) {
  const now = new Date().toISOString();
  const id = `task-${crypto.randomUUID()}`;
  const fingerprint =
    input.fingerprint ??
    computeFingerprint(`${input.title}\n${input.source ?? ""}\n${input.severity ?? ""}`.trim());

  const task: MissionControlTaskRecord = {
    id,
    createdAt: now,
    updatedAt: now,
    title: input.title,
    description: input.description ?? null,
    status: input.status ?? "inbox",
    priority: input.priority ?? "medium",
    source: input.source ?? null,
    severity: input.severity ?? null,
    trustTier: input.trustTier ?? cfg.missionControl?.trust?.defaultTier ?? null,
    fingerprint,
    assignees: input.assignees ?? [],
    labels: input.labels ?? [],
    parentTaskId: input.parentTaskId ?? null,
    meta: input.meta ?? {},
  };

  const insertResult = insertTask(cfg, task);
  if (!insertResult.ok && insertResult.existingId) {
    return { ok: false, task: null as MissionControlTaskRecord | null, existingId: insertResult.existingId };
  }

  appendMissionControlRecord({
    cfg,
    kind: "tasks",
    record: {
      id: task.id,
      ts: now,
      source: "system",
      version: 1,
      title: task.title,
      status: task.status,
      priority: task.priority,
      meta: task.meta ?? {},
    } as any,
  }).catch(() => {});

  if (task.assignees && task.assignees.length > 0) {
    for (const agentId of task.assignees) {
      addTaskSubscription(cfg, task.id, agentId, "assigned");
    }
  }

  return { ok: true, task, existingId: null } as const;
}


function maybeCreateReconTask(cfg: SurprisebotConfig, task: MissionControlTaskRecord) {
  if (cfg.missionControl?.killSwitch) return;
  const labels = task.labels ?? [];
  const shouldSpawn = labels.includes("exposure") || task.severity === "high";
  if (!shouldSpawn) return;
  if (task.trustTier === "quarantine") return;
  const reconAgent = cfg.missionControl?.recon?.agentId?.trim() || "surprisebot-recon";
  const res = createTask(cfg, {
    title: `Recon follow-up: ${task.title}`,
    description: task.description ?? undefined,
    status: "assigned",
    priority: task.priority,
    source: "recon",
    severity: task.severity ?? undefined,
    trustTier: "trusted",
    parentTaskId: task.id,
    assignees: [reconAgent],
    labels: ["recon", "follow-up"],
  });
  if (res.ok && res.task) {
    addTaskActivity(cfg, {
      taskId: res.task.id,
      type: "task_created",
      message: `Recon task created from ${task.id}`,
      meta: { parentTaskId: task.id },
    });
  }
}

export function updateTaskStatus(cfg: SurprisebotConfig, taskId: string, status: MissionControlTaskStatus) {
  const now = new Date().toISOString();
  const task = getTask(cfg, taskId);
  if (!task) return { ok: false, error: "task not found" } as const;
  const res = updateTask(cfg, taskId, { status });
  if (!res.ok) return res;

  if (status === "verified" && task.status !== "verified") {
    maybeCreateReconTask(cfg, { ...task, status });
    const source = task.source ?? "";
    const shouldAlert = source === "research" || source === "exposure" || source.startsWith("artemis");
    if (shouldAlert) {
      const sessionKey = resolveMainSessionKey(cfg);
      enqueueSystemEvent(`Verified ${source || "finding"}: ${task.title}`, {
        sessionKey,
        contextKey: `task:${taskId}`,
      });
      requestHeartbeatNow({ reason: `task:verified:${taskId}`, coalesceMs: 1_000 });
    }
  }

  const meta = task.meta ?? {};
  const runId = typeof (meta as Record<string, unknown>).runId === "string" ? (meta as Record<string, unknown>).runId as string : null;
  if (runId && (task.source ?? "").startsWith("artemis")) {
    void recordArtemisMetrics({ cfg, runId, source: task.source ?? "artemis" }).catch(() => {});
  }

  appendMissionControlRecord({
    cfg,
    kind: "activities",
    record: {
      id: `activity-${crypto.randomUUID()}`,
      ts: now,
      source: "system",
      version: 1,
      type: "task_updated",
      message: `Task ${taskId} status -> ${status}`,
      meta: { taskId, status },
    } as any,
  }).catch(() => {});

  insertActivity(cfg, {
    id: `activity-${crypto.randomUUID()}`,
    createdAt: now,
    type: "task_updated",
    message: `Status changed to ${status}`,
    taskId,
  });

  return { ok: true } as const;
}

export function addTaskMessage(cfg: SurprisebotConfig, msg: Omit<MissionControlMessageRecord, "id" | "createdAt">) {
  const now = new Date().toISOString();
  const record: MissionControlMessageRecord = {
    id: `msg-${crypto.randomUUID()}`,
    createdAt: now,
    ...msg,
  };
  insertMessage(cfg, record);
  appendMissionControlRecord({
    cfg,
    kind: "messages",
    record: {
      id: record.id,
      ts: now,
      source: "agent",
      version: 1,
      taskId: record.taskId,
      content: record.content,
      meta: record.meta ?? {},
    } as any,
  }).catch(() => {});
  return record;
}

export function addTaskActivity(cfg: SurprisebotConfig, activity: Omit<MissionControlActivityRecord, "id" | "createdAt">) {
  const now = new Date().toISOString();
  const record: MissionControlActivityRecord = {
    id: `activity-${crypto.randomUUID()}`,
    createdAt: now,
    ...activity,
  };
  insertActivity(cfg, record);
  appendMissionControlRecord({
    cfg,
    kind: "activities",
    record: {
      id: record.id,
      ts: now,
      source: "system",
      version: 1,
      type: record.type,
      message: record.message,
      meta: record.meta ?? {},
    } as any,
  }).catch(() => {});
  return record;
}

export function addTaskSubscription(cfg: SurprisebotConfig, taskId: string, agentId: string, reason?: string) {
  const now = new Date().toISOString();
  const record = {
    id: `sub-${crypto.randomUUID()}`,
    taskId,
    agentId,
    reason: reason ?? "assigned",
    createdAt: now,
  };
  insertSubscription(cfg, record);
  appendMissionControlRecord({
    cfg,
    kind: "subscriptions",
    record: {
      id: record.id,
      ts: now,
      source: "system",
      version: 1,
      taskId: record.taskId,
      agentId: record.agentId,
      meta: { reason: record.reason },
    } as any,
  }).catch(() => {});
  return record;
}

export function addTaskDocument(cfg: SurprisebotConfig, doc: Omit<MissionControlDocumentRecord, "id" | "createdAt">) {
  const now = new Date().toISOString();
  const record: MissionControlDocumentRecord = {
    id: `doc-${crypto.randomUUID()}`,
    createdAt: now,
    ...doc,
  };
  insertDocument(cfg, record);
  appendMissionControlRecord({
    cfg,
    kind: "documents",
    record: {
      id: record.id,
      ts: now,
      source: "agent",
      version: 1,
      title: record.title,
      docType: record.docType,
      path: record.path,
      meta: record.meta ?? {},
    } as any,
  }).catch(() => {});
  return record;
}

export function addNotification(cfg: SurprisebotConfig, notification: Omit<MissionControlNotificationRecord, "id" | "createdAt">) {
  const now = new Date().toISOString();
  const record: MissionControlNotificationRecord = {
    id: `notify-${crypto.randomUUID()}`,
    createdAt: now,
    ...notification,
  };
  insertNotification(cfg, record);
  appendMissionControlRecord({
    cfg,
    kind: "notifications",
    record: {
      id: record.id,
      ts: now,
      source: "system",
      version: 1,
      type: notification.targetKind,
      target: { kind: notification.targetKind, id: notification.targetId },
      content: notification.content,
      meta: notification.meta ?? {},
    } as any,
  }).catch(() => {});
  return record;
}
