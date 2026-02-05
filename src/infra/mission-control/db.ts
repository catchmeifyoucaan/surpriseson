import path from "node:path";
import crypto from "node:crypto";

import type { DatabaseSync } from "node:sqlite";
import type { SurprisebotConfig } from "../../config/config.js";
import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { applySqlitePragmas, requireNodeSqlite } from "../../memory/sqlite.js";
import { createSubsystemLogger } from "../../logging.js";

const log = createSubsystemLogger("gateway/mission-control-db");

export type MissionControlTaskStatus =
  | "inbox"
  | "assigned"
  | "in_progress"
  | "review"
  | "verified"
  | "done"
  | "blocked"
  | "cancelled";

export type MissionControlTaskPriority = "low" | "medium" | "high" | "critical";

export type MissionControlTrustTier = "trusted" | "unverified" | "quarantine";

export type MissionControlTaskRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  description?: string | null;
  status: MissionControlTaskStatus;
  priority: MissionControlTaskPriority;
  source?: string | null;
  severity?: "low" | "medium" | "high" | null;
  trustTier?: MissionControlTrustTier | null;
  fingerprint?: string | null;
  assignees?: string[];
  labels?: string[];
  parentTaskId?: string | null;
  meta?: Record<string, unknown>;
};

export type MissionControlMessageRecord = {
  id: string;
  taskId: string;
  createdAt: string;
  authorId?: string | null;
  content: string;
  evidence?: string[];
  attachments?: string[];
  meta?: Record<string, unknown>;
};

export type MissionControlActivityRecord = {
  id: string;
  taskId?: string | null;
  createdAt: string;
  type: string;
  message: string;
  actorId?: string | null;
  meta?: Record<string, unknown>;
};

export type MissionControlSubscriptionRecord = {
  id: string;
  taskId: string;
  agentId: string;
  reason?: string | null;
  createdAt: string;
};

export type MissionControlDocumentRecord = {
  id: string;
  taskId?: string | null;
  title: string;
  docType: string;
  path: string;
  hash?: string | null;
  createdAt: string;
  meta?: Record<string, unknown>;
};

export type MissionControlNotificationRecord = {
  id: string;
  targetKind: "agent" | "channel";
  targetId: string;
  content: string;
  delivered: number;
  createdAt: string;
  deliveredAt?: string | null;
  meta?: Record<string, unknown>;
};

type MissionControlDbHandle = {
  db: DatabaseSync;
  path: string;
};

const DB_CACHE = new Map<string, MissionControlDbHandle>();

function resolveWorkspaceDir(cfg: SurprisebotConfig): string {
  const agentId = resolveDefaultAgentId(cfg);
  return resolveAgentWorkspaceDir(cfg, agentId);
}

export function resolveMissionControlDbPath(cfg: SurprisebotConfig): string {
  const workspace = resolveWorkspaceDir(cfg);
  const override = cfg.missionControl?.dbPath?.trim();
  if (override) return override;
  return path.join(workspace, "memory", "mission-control.db");
}

export function openMissionControlDb(cfg: SurprisebotConfig): MissionControlDbHandle {
  const dbPath = resolveMissionControlDbPath(cfg);
  const existing = DB_CACHE.get(dbPath);
  if (existing) return existing;
  const sqlite = requireNodeSqlite();
  const db = new sqlite.DatabaseSync(dbPath);
  applySqlitePragmas(db);
  ensureSchema(db);
  const handle = { db, path: dbPath };
  DB_CACHE.set(dbPath, handle);
  return handle;
}

export function closeMissionControlDb(dbPath?: string) {
  if (!dbPath) return;
  const entry = DB_CACHE.get(dbPath);
  if (entry) {
    entry.db.close();
    DB_CACHE.delete(dbPath);
  }
}

function ensureSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL,
      priority TEXT NOT NULL,
      source TEXT,
      severity TEXT,
      trust_tier TEXT,
      fingerprint TEXT UNIQUE,
      assignees TEXT,
      labels TEXT,
      parent_task_id TEXT,
      meta TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_updated ON tasks(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority);
    CREATE INDEX IF NOT EXISTS idx_tasks_fingerprint ON tasks(fingerprint);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      author_id TEXT,
      content TEXT NOT NULL,
      evidence TEXT,
      attachments TEXT,
      meta TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

    CREATE TABLE IF NOT EXISTS activities (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      created_at TEXT NOT NULL,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      actor_id TEXT,
      meta TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_activities_task ON activities(task_id);
    CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at);

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_subscriptions_task ON subscriptions(task_id);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_agent ON subscriptions(agent_id);

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      title TEXT NOT NULL,
      doc_type TEXT NOT NULL,
      path TEXT NOT NULL,
      hash TEXT,
      created_at TEXT NOT NULL,
      meta TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_documents_task ON documents(task_id);

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      content TEXT NOT NULL,
      delivered INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      delivered_at TEXT,
      meta TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_target ON notifications(target_kind, target_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_delivered ON notifications(delivered);
  `);
}

export function computeFingerprint(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function toJson(value: unknown): string | null {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function fromJson<T>(raw?: string | null, fallback?: T): T | undefined {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function insertTask(cfg: SurprisebotConfig, task: MissionControlTaskRecord): { ok: boolean; existingId?: string } {
  const { db } = openMissionControlDb(cfg);
  try {
    const stmt = db.prepare(`
      INSERT INTO tasks (
        id, created_at, updated_at, title, description, status, priority, source, severity, trust_tier,
        fingerprint, assignees, labels, parent_task_id, meta
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      task.id,
      task.createdAt,
      task.updatedAt,
      task.title,
      task.description ?? null,
      task.status,
      task.priority,
      task.source ?? null,
      task.severity ?? null,
      task.trustTier ?? null,
      task.fingerprint ?? null,
      toJson(task.assignees) ?? null,
      toJson(task.labels) ?? null,
      task.parentTaskId ?? null,
      toJson(task.meta) ?? null,
    );
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("UNIQUE constraint failed: tasks.fingerprint")) {
      const row = db.prepare("SELECT id FROM tasks WHERE fingerprint = ?").get(task.fingerprint ?? "") as
        | { id: string }
        | undefined;
      return { ok: false, existingId: row?.id };
    }
    log.warn("mission control task insert failed", { err: message });
    return { ok: false };
  }
}

export function updateTask(cfg: SurprisebotConfig, taskId: string, patch: Partial<MissionControlTaskRecord>) {
  const { db } = openMissionControlDb(cfg);
  const now = new Date().toISOString();
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Record<string, unknown> | undefined;
  if (!row) return { ok: false, error: "task not found" };
  const current = hydrateTask(row);
  const next = {
    title: patch.title ?? current.title,
    description: patch.description ?? current.description,
    status: patch.status ?? current.status,
    priority: patch.priority ?? current.priority,
    source: patch.source ?? current.source,
    severity: patch.severity ?? current.severity,
    trust_tier: patch.trustTier ?? current.trustTier,
    fingerprint: patch.fingerprint ?? current.fingerprint,
    assignees: toJson(patch.assignees ?? current.assignees) ?? null,
    labels: toJson(patch.labels ?? current.labels) ?? null,
    parent_task_id: patch.parentTaskId ?? current.parentTaskId,
    meta: toJson(patch.meta ?? current.meta) ?? null,
  };
  db.prepare(
    `UPDATE tasks SET updated_at = ?, title = ?, description = ?, status = ?, priority = ?, source = ?, severity = ?, trust_tier = ?, fingerprint = ?, assignees = ?, labels = ?, parent_task_id = ?, meta = ? WHERE id = ?`,
  ).run(
    now,
    next.title,
    next.description ?? null,
    next.status,
    next.priority,
    next.source ?? null,
    next.severity ?? null,
    next.trust_tier ?? null,
    next.fingerprint ?? null,
    next.assignees,
    next.labels,
    next.parent_task_id ?? null,
    next.meta,
    taskId,
  );
  return { ok: true };
}

export function listTasksByRunId(cfg: SurprisebotConfig, runId: string) {
  const { db } = openMissionControlDb(cfg);
  const rows = db.prepare("SELECT * FROM tasks").all() as Record<string, unknown>[];
  return rows
    .map((row) => hydrateTask(row))
    .filter((task) => {
      const meta = task.meta ?? {};
      const value = (meta as Record<string, unknown>).runId;
      return typeof value === "string" && value === runId;
    });
}

export function listTasks(cfg: SurprisebotConfig, opts?: { status?: MissionControlTaskStatus; limit?: number; offset?: number }) {
  const { db } = openMissionControlDb(cfg);
  const limit = opts?.limit ?? 50;
  const offset = Math.max(0, opts?.offset ?? 0);
  const rows = opts?.status
    ? (db.prepare("SELECT * FROM tasks WHERE status = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(opts.status, limit, offset) as
        | Record<string, unknown>[])
    : (db.prepare("SELECT * FROM tasks ORDER BY updated_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Record<string, unknown>[]);
  return rows.map((row) => hydrateTask(row));
}

export function countTasks(cfg: SurprisebotConfig, opts?: { status?: MissionControlTaskStatus }) {
  const { db } = openMissionControlDb(cfg);
  const row = opts?.status
    ? (db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = ?").get(opts.status) as Record<string, unknown>)
    : (db.prepare("SELECT COUNT(*) as count FROM tasks").get() as Record<string, unknown>);
  return Number(row?.count ?? 0);
}

export function countMessages(cfg: SurprisebotConfig, opts?: { taskId?: string }) {
  const { db } = openMissionControlDb(cfg);
  const row = opts?.taskId
    ? (db.prepare("SELECT COUNT(*) as count FROM messages WHERE task_id = ?").get(opts.taskId) as Record<string, unknown>)
    : (db.prepare("SELECT COUNT(*) as count FROM messages").get() as Record<string, unknown>);
  return Number(row?.count ?? 0);
}

export function countActivities(cfg: SurprisebotConfig, opts?: { taskId?: string }) {
  const { db } = openMissionControlDb(cfg);
  const row = opts?.taskId
    ? (db.prepare("SELECT COUNT(*) as count FROM activities WHERE task_id = ?").get(opts.taskId) as Record<string, unknown>)
    : (db.prepare("SELECT COUNT(*) as count FROM activities").get() as Record<string, unknown>);
  return Number(row?.count ?? 0);
}

export function countDocuments(cfg: SurprisebotConfig, opts?: { taskId?: string }) {
  const { db } = openMissionControlDb(cfg);
  const row = opts?.taskId
    ? (db.prepare("SELECT COUNT(*) as count FROM documents WHERE task_id = ?").get(opts.taskId) as Record<string, unknown>)
    : (db.prepare("SELECT COUNT(*) as count FROM documents").get() as Record<string, unknown>);
  return Number(row?.count ?? 0);
}

export function countSubscriptions(cfg: SurprisebotConfig, opts?: { taskId?: string }) {
  const { db } = openMissionControlDb(cfg);
  const row = opts?.taskId
    ? (db.prepare("SELECT COUNT(*) as count FROM subscriptions WHERE task_id = ?").get(opts.taskId) as Record<string, unknown>)
    : (db.prepare("SELECT COUNT(*) as count FROM subscriptions").get() as Record<string, unknown>);
  return Number(row?.count ?? 0);
}

export function countNotifications(cfg: SurprisebotConfig, opts?: { delivered?: number }) {
  const { db } = openMissionControlDb(cfg);
  const row = typeof opts?.delivered === "number"
    ? (db.prepare("SELECT COUNT(*) as count FROM notifications WHERE delivered = ?").get(opts.delivered) as Record<string, unknown>)
    : (db.prepare("SELECT COUNT(*) as count FROM notifications").get() as Record<string, unknown>);
  return Number(row?.count ?? 0);
}

export function getTask(cfg: SurprisebotConfig, id: string): MissionControlTaskRecord | null {
  const { db } = openMissionControlDb(cfg);
  const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return hydrateTask(row);
}

function hydrateTask(row: Record<string, unknown>): MissionControlTaskRecord {
  return {
    id: String(row.id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    status: row.status as MissionControlTaskStatus,
    priority: row.priority as MissionControlTaskPriority,
    source: (row.source as string | null) ?? null,
    severity: (row.severity as string | null) as MissionControlTaskRecord["severity"],
    trustTier: (row.trust_tier as string | null) as MissionControlTaskRecord["trustTier"],
    fingerprint: (row.fingerprint as string | null) ?? null,
    assignees: fromJson<string[]>(row.assignees as string, []),
    labels: fromJson<string[]>(row.labels as string, []),
    parentTaskId: (row.parent_task_id as string | null) ?? null,
    meta: fromJson<Record<string, unknown>>(row.meta as string, {}),
  };
}


export function listMessages(cfg: SurprisebotConfig, opts?: { taskId?: string; limit?: number; offset?: number }) {
  const { db } = openMissionControlDb(cfg);
  const limit = opts?.limit ?? 100;
  const offset = Math.max(0, opts?.offset ?? 0);
  const rows = opts?.taskId
    ? (db.prepare("SELECT * FROM messages WHERE task_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(opts.taskId, limit, offset) as Record<string, unknown>[])
    : (db.prepare("SELECT * FROM messages ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Record<string, unknown>[]);
  return rows.map((row) => hydrateMessage(row));
}

export function listActivities(cfg: SurprisebotConfig, opts?: { taskId?: string; limit?: number; offset?: number }) {
  const { db } = openMissionControlDb(cfg);
  const limit = opts?.limit ?? 100;
  const offset = Math.max(0, opts?.offset ?? 0);
  const rows = opts?.taskId
    ? (db.prepare("SELECT * FROM activities WHERE task_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(opts.taskId, limit, offset) as Record<string, unknown>[])
    : (db.prepare("SELECT * FROM activities ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Record<string, unknown>[]);
  return rows.map((row) => hydrateActivity(row));
}

export function listDocuments(cfg: SurprisebotConfig, opts?: { taskId?: string; limit?: number; offset?: number }) {
  const { db } = openMissionControlDb(cfg);
  const limit = opts?.limit ?? 100;
  const offset = Math.max(0, opts?.offset ?? 0);
  const rows = opts?.taskId
    ? (db.prepare("SELECT * FROM documents WHERE task_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(opts.taskId, limit, offset) as Record<string, unknown>[])
    : (db.prepare("SELECT * FROM documents ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Record<string, unknown>[]);
  return rows.map((row) => hydrateDocument(row));
}

export function listSubscriptions(cfg: SurprisebotConfig, opts?: { taskId?: string; limit?: number; offset?: number }) {
  const { db } = openMissionControlDb(cfg);
  const limit = opts?.limit ?? 100;
  const offset = Math.max(0, opts?.offset ?? 0);
  const rows = opts?.taskId
    ? (db.prepare("SELECT * FROM subscriptions WHERE task_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(opts.taskId, limit, offset) as Record<string, unknown>[])
    : (db.prepare("SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Record<string, unknown>[]);
  return rows.map((row) => hydrateSubscription(row));
}

export function listNotifications(cfg: SurprisebotConfig, opts?: { limit?: number; offset?: number; delivered?: number }) {
  const { db } = openMissionControlDb(cfg);
  const limit = opts?.limit ?? 100;
  const offset = Math.max(0, opts?.offset ?? 0);
  const rows = typeof opts?.delivered === "number"
    ? (db.prepare("SELECT * FROM notifications WHERE delivered = ? ORDER BY created_at DESC LIMIT ? OFFSET ?").all(opts.delivered, limit, offset) as Record<string, unknown>[])
    : (db.prepare("SELECT * FROM notifications ORDER BY created_at DESC LIMIT ? OFFSET ?").all(limit, offset) as Record<string, unknown>[]);
  return rows.map((row) => hydrateNotification(row));
}

function hydrateMessage(row: Record<string, unknown>): MissionControlMessageRecord {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    createdAt: String(row.created_at),
    authorId: (row.author_id as string | null) ?? null,
    content: String(row.content ?? ""),
    evidence: fromJson<string[]>(row.evidence as string, []),
    attachments: fromJson<string[]>(row.attachments as string, []),
    meta: fromJson<Record<string, unknown>>(row.meta as string, {}),
  };
}

function hydrateActivity(row: Record<string, unknown>): MissionControlActivityRecord {
  return {
    id: String(row.id),
    taskId: (row.task_id as string | null) ?? null,
    createdAt: String(row.created_at),
    type: String(row.type ?? ""),
    message: String(row.message ?? ""),
    actorId: (row.actor_id as string | null) ?? null,
    meta: fromJson<Record<string, unknown>>(row.meta as string, {}),
  };
}

function hydrateDocument(row: Record<string, unknown>): MissionControlDocumentRecord {
  return {
    id: String(row.id),
    taskId: (row.task_id as string | null) ?? null,
    title: String(row.title ?? ""),
    docType: String(row.doc_type ?? ""),
    path: String(row.path ?? ""),
    hash: (row.hash as string | null) ?? null,
    createdAt: String(row.created_at),
    meta: fromJson<Record<string, unknown>>(row.meta as string, {}),
  };
}

function hydrateSubscription(row: Record<string, unknown>): MissionControlSubscriptionRecord {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    agentId: String(row.agent_id),
    reason: (row.reason as string | null) ?? null,
    createdAt: String(row.created_at),
  };
}

function hydrateNotification(row: Record<string, unknown>): MissionControlNotificationRecord {
  return {
    id: String(row.id),
    targetKind: row.target_kind as MissionControlNotificationRecord["targetKind"],
    targetId: String(row.target_id),
    content: String(row.content ?? ""),
    delivered: Number(row.delivered ?? 0),
    createdAt: String(row.created_at),
    deliveredAt: (row.delivered_at as string | null) ?? null,
    meta: fromJson<Record<string, unknown>>(row.meta as string, {}),
  };
}

export function insertMessage(cfg: SurprisebotConfig, msg: MissionControlMessageRecord) {
  const { db } = openMissionControlDb(cfg);
  db.prepare(
    `INSERT INTO messages (id, task_id, created_at, author_id, content, evidence, attachments, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    msg.id,
    msg.taskId,
    msg.createdAt,
    msg.authorId ?? null,
    msg.content,
    toJson(msg.evidence) ?? null,
    toJson(msg.attachments) ?? null,
    toJson(msg.meta) ?? null,
  );
}

export function insertActivity(cfg: SurprisebotConfig, activity: MissionControlActivityRecord) {
  const { db } = openMissionControlDb(cfg);
  db.prepare(
    `INSERT INTO activities (id, task_id, created_at, type, message, actor_id, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    activity.id,
    activity.taskId ?? null,
    activity.createdAt,
    activity.type,
    activity.message,
    activity.actorId ?? null,
    toJson(activity.meta) ?? null,
  );
}

export function insertSubscription(cfg: SurprisebotConfig, sub: MissionControlSubscriptionRecord) {
  const { db } = openMissionControlDb(cfg);
  db.prepare(
    `INSERT INTO subscriptions (id, task_id, agent_id, reason, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(sub.id, sub.taskId, sub.agentId, sub.reason ?? null, sub.createdAt);
}

export function insertDocument(cfg: SurprisebotConfig, doc: MissionControlDocumentRecord) {
  const { db } = openMissionControlDb(cfg);
  db.prepare(
    `INSERT INTO documents (id, task_id, title, doc_type, path, hash, created_at, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    doc.id,
    doc.taskId ?? null,
    doc.title,
    doc.docType,
    doc.path,
    doc.hash ?? null,
    doc.createdAt,
    toJson(doc.meta) ?? null,
  );
}

export function insertNotification(cfg: SurprisebotConfig, notification: MissionControlNotificationRecord) {
  const { db } = openMissionControlDb(cfg);
  db.prepare(
    `INSERT INTO notifications (id, target_kind, target_id, content, delivered, created_at, delivered_at, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    notification.id,
    notification.targetKind,
    notification.targetId,
    notification.content,
    notification.delivered,
    notification.createdAt,
    notification.deliveredAt ?? null,
    toJson(notification.meta) ?? null,
  );
}
