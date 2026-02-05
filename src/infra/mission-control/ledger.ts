import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import type { SurprisebotConfig } from "../../config/config.js";
import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { createSubsystemLogger } from "../../logging.js";

export type MissionControlRecordKind =
  | "agents"
  | "tasks"
  | "messages"
  | "activities"
  | "documents"
  | "notifications"
  | "subscriptions"
  | "signals"
  | "run-ledger"
  | "budget-ledger";

export type MissionControlBaseRecord = {
  id: string;
  ts: string;
  source?: string;
  version?: number;
  meta?: Record<string, unknown>;
};

export type RunLedgerRecord = MissionControlBaseRecord & {
  taskId?: string | null;
  agentId?: string | null;
  status?: "queued" | "running" | "done" | "failed" | "cancelled";
  command?: string | null;
  pid?: number | null;
  logPath?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
  jobType?: string | null;
  estimatedTokens?: number | null;
};

export type BudgetLedgerRecord = MissionControlBaseRecord & {
  scope: "global" | "agent" | "job" | "run";
  scopeId?: string | null;
  decision: "allow" | "defer" | "deny" | "throttle";
  reason: string;
  budgetSnapshot: Record<string, unknown>;
};

const log = createSubsystemLogger("gateway/mission-control");

const LEDGER_FILES: Record<MissionControlRecordKind, string> = {
  agents: "agents.jsonl",
  tasks: "tasks.jsonl",
  messages: "messages.jsonl",
  activities: "activities.jsonl",
  documents: "documents.jsonl",
  notifications: "notifications.jsonl",
  subscriptions: "subscriptions.jsonl",
  signals: "signals.jsonl",
  "run-ledger": "run-ledger.jsonl",
  "budget-ledger": "budget-ledger.jsonl",
};


function resolveWorkspaceDir(cfg: SurprisebotConfig): string {
  const agentId = resolveDefaultAgentId(cfg);
  return resolveAgentWorkspaceDir(cfg, agentId);
}

const REQUIRED_FIELDS: Record<MissionControlRecordKind, Array<keyof MissionControlBaseRecord | string>> = {
  agents: ["id", "ts", "name", "role", "status", "sessionKey"],
  tasks: ["id", "ts", "title", "status"],
  messages: ["id", "ts", "taskId", "content"],
  activities: ["id", "ts", "type", "message"],
  documents: ["id", "ts", "title", "docType", "path"],
  notifications: ["id", "ts", "type", "target", "content"],
  subscriptions: ["id", "ts", "taskId", "agentId"],
  signals: ["id", "ts", "kind", "category"],
  "run-ledger": ["id", "ts", "status"],
  "budget-ledger": ["id", "ts", "scope", "decision", "reason", "budgetSnapshot"],
};

export type MissionControlValidationResult = {
  ok: boolean;
  errors: string[];
};

export function resolveMissionControlDir(cfg: SurprisebotConfig): string {
  const override = cfg.missionControl?.ledgerDir?.trim();
  if (override) return override;
  const workspace = resolveWorkspaceDir(cfg);
  return path.join(workspace, "memory", "mission-control");
}

export function resolveMissionControlPaths(cfg: SurprisebotConfig): {
  dir: string;
  attachmentsDir: string;
  files: Record<MissionControlRecordKind, string>;
} {
  const dir = resolveMissionControlDir(cfg);
  const attachmentsDir = path.join(dir, "attachments");
  const files = Object.fromEntries(
    Object.entries(LEDGER_FILES).map(([kind, filename]) => [kind, path.join(dir, filename)]),
  ) as Record<MissionControlRecordKind, string>;
  return { dir, attachmentsDir, files };
}

export async function ensureMissionControlLedger(cfg: SurprisebotConfig): Promise<
  ReturnType<typeof resolveMissionControlPaths>
> {
  const paths = resolveMissionControlPaths(cfg);
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.mkdir(paths.attachmentsDir, { recursive: true });
  await Promise.all(
    Object.values(paths.files).map(async (filePath) => {
      const handle = await fs.open(filePath, "a");
      await handle.close();
    }),
  );
  return paths;
}

function validateBaseRecord(record: MissionControlBaseRecord, errors: string[]) {
  if (!record || typeof record !== "object") {
    errors.push("record must be an object");
    return;
  }
  if (typeof record.id !== "string" || !record.id.trim()) errors.push("id is required");
  if (typeof record.ts !== "string" || !record.ts.trim()) errors.push("ts is required");
  if (record.version !== undefined && typeof record.version !== "number") {
    errors.push("version must be a number when provided");
  }
}

export function validateMissionControlRecord(
  kind: MissionControlRecordKind,
  record: MissionControlBaseRecord,
): MissionControlValidationResult {
  const errors: string[] = [];
  validateBaseRecord(record, errors);
  const required = REQUIRED_FIELDS[kind] ?? [];
  for (const field of required) {
    if (!(field in (record as Record<string, unknown>))) {
      errors.push(`${String(field)} is required`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export async function appendMissionControlRecord<T extends MissionControlBaseRecord>(params: {
  cfg: SurprisebotConfig;
  kind: MissionControlRecordKind;
  record: T;
  validate?: boolean;
}): Promise<void> {
  const paths = resolveMissionControlPaths(params.cfg);
  if (params.validate !== false) {
    const validation = validateMissionControlRecord(params.kind, params.record);
    if (!validation.ok) {
      log.warn(
        `mission control record failed validation (${params.kind}): ${validation.errors.join(", ")}`,
      );
      throw new Error(`mission control record invalid: ${validation.errors.join(", ")}`);
    }
  }
  await fs.mkdir(path.dirname(paths.files[params.kind]), { recursive: true });
  await fs.appendFile(paths.files[params.kind], `${JSON.stringify(params.record)}\n`);
}

export async function readMissionControlRecords<T = MissionControlBaseRecord>(params: {
  cfg: SurprisebotConfig;
  kind: MissionControlRecordKind;
  sinceMs?: number;
  limit?: number;
}): Promise<T[]> {
  const paths = resolveMissionControlPaths(params.cfg);
  const filePath = paths.files[params.kind];
  try {
    await fs.stat(filePath);
  } catch {
    return [];
  }
  const results: T[] = [];
  const handle = await fs.open(filePath, "r");
  const stream = handle.createReadStream({ encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as MissionControlBaseRecord;
      const tsMs = Date.parse(parsed.ts ?? "");
      if (Number.isFinite(params.sinceMs ?? 0) && Number.isFinite(tsMs)) {
        if (tsMs < Number(params.sinceMs)) continue;
      }
      results.push(parsed as T);
      if (params.limit && results.length >= params.limit) break;
    } catch {
      continue;
    }
  }
  await rl.close();
  await stream.close();
  await handle.close();
  return results;
}
