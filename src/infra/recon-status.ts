import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SurprisebotConfig } from "../config/config.js";
import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import { enqueueSystemEvent } from "./system-events.js";
import { requestHeartbeatNow } from "./heartbeat-wake.js";
import { resolveMainSessionKey } from "../config/sessions.js";

export type ReconStatus = {
  running: boolean;
  pid?: number;
  logPath?: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  runId?: string;
  reason?: string;
};

const RECON_STATUS_FILENAME = "status.json";
const RECON_CMD_MARKER = "recon/run.sh";

type ReconIncident = {
  id: string;
  ts: string;
  source: string;
  severity: "low" | "medium" | "high";
  summary: string;
  evidence?: string[];
  meta?: Record<string, unknown>;
};

let lastSeenRunningPid: number | null = null;
let lastSeenRunningRunId: string | null = null;
let lastFinishedAtMs: number | null = null;
let lastFinishedPid: number | null = null;
let lastFinishedRunId: string | null = null;

function makeIncidentId(): string {
  return `inc-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function resolveIncidentsPath(cfg: SurprisebotConfig): string {
  return path.join(resolveWorkspaceDir(cfg), "memory", "incidents.jsonl");
}

async function appendReconIncident(cfg: SurprisebotConfig, incident: ReconIncident) {
  const incidentsPath = resolveIncidentsPath(cfg);
  await fs.promises.mkdir(path.dirname(incidentsPath), { recursive: true });
  await fs.promises.appendFile(incidentsPath, `${JSON.stringify(incident)}\n`);
}

function resolveWorkspaceDir(cfg: SurprisebotConfig): string {
  const agentId = resolveDefaultAgentId(cfg);
  return resolveAgentWorkspaceDir(cfg, agentId);
}

function resolveStatusPath(cfg: SurprisebotConfig): string {
  return path.join(resolveWorkspaceDir(cfg), "recon", RECON_STATUS_FILENAME);
}

async function readStatusFile(statusPath: string): Promise<ReconStatus | null> {
  try {
    const raw = await fs.promises.readFile(statusPath, "utf8");
    const parsed = JSON.parse(raw) as ReconStatus | null;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function pidExists(pid: number): Promise<boolean> {
  try {
    await fs.promises.access(`/proc/${pid}`);
    return true;
  } catch {
    return false;
  }
}

async function pidMatchesRecon(pid: number): Promise<boolean> {
  try {
    const cmdline = await fs.promises.readFile(`/proc/${pid}/cmdline`, "utf8");
    return cmdline.includes(RECON_CMD_MARKER);
  } catch {
    return false;
  }
}


async function markReconFinishedOnce(cfg: SurprisebotConfig, key: string): Promise<boolean> {
  const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, "_");
  const markerDir = path.join(resolveWorkspaceDir(cfg), "recon", ".status");
  const markerPath = path.join(markerDir, `finished-${safeKey}.marker`);
  await fs.promises.mkdir(markerDir, { recursive: true });
  try {
    const handle = await fs.promises.open(markerPath, "wx");
    await handle.close();
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

async function logExists(logPath?: string): Promise<boolean> {
  if (!logPath) return false;
  try {
    const stat = await fs.promises.stat(logPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function getVerifiedReconStatus(cfg: SurprisebotConfig): Promise<ReconStatus> {
  const statusPath = resolveStatusPath(cfg);
  const status = await readStatusFile(statusPath);
  if (!status) {
    return { running: false, reason: "status-file-missing" };
  }
  const pid = typeof status.pid === "number" ? status.pid : undefined;
  const logPath = typeof status.logPath === "string" ? status.logPath : undefined;
  const runId = typeof status.runId === "string" ? status.runId : undefined;
  const startedAt = typeof status.startedAt === "string" ? status.startedAt : undefined;
  const finishedAt = typeof status.finishedAt === "string" ? status.finishedAt : undefined;
  const exitCode = typeof status.exitCode === "number" ? status.exitCode : undefined;
  if (!pid) {
    return { running: false, reason: "pid-missing" };
  }
  if (!(await pidExists(pid))) {
    return {
      running: false,
      pid,
      logPath,
      startedAt,
      finishedAt,
      exitCode,
      runId,
      reason: "pid-not-running",
    };
  }
  if (!(await pidMatchesRecon(pid))) {
    return {
      running: false,
      pid,
      logPath,
      startedAt,
      finishedAt,
      exitCode,
      runId,
      reason: "pid-mismatch",
    };
  }
  if (!(await logExists(logPath))) {
    return {
      running: false,
      pid,
      logPath,
      startedAt,
      finishedAt,
      exitCode,
      runId,
      reason: "log-missing",
    };
  }
  return {
    running: true,
    pid,
    logPath,
    startedAt,
    runId,
  };
}

function needsReconGate(text: string): boolean {
  return /recon\/run\.sh|recon pipeline|running job|\bPID\b/i.test(text);
}

function enforceReconGate(text: string, status: ReconStatus): string {
  const lines = text.split(/\r?\n/);
  if (!lines.some((line) => needsReconGate(line))) return text;

  const filtered = lines.filter(
    (line) => !/recon\/run\.sh|running job|recon pipeline/i.test(line),
  );
  if (status.running) {
    filtered.push(
      `Recon status (verified): running (PID ${status.pid}) log ${status.logPath}.`,
    );
  } else {
    const reason = status.reason ? ` (${status.reason})` : "";
    filtered.push(`Recon status (verified): not running${reason}.`);
  }
  return filtered.join("\n");
}

export async function applyReconStatusGate(params: {
  cfg: SurprisebotConfig;
  payloads: ReplyPayload[];
}): Promise<ReplyPayload[]> {
  const { payloads, cfg } = params;
  const hasClaim = payloads.some(
    (payload) => typeof payload.text === "string" && needsReconGate(payload.text),
  );
  if (!hasClaim) return payloads;
  const status = await getVerifiedReconStatus(cfg);
  return payloads.map((payload) => {
    if (!payload.text) return payload;
    return { ...payload, text: enforceReconGate(payload.text, status) };
  });
}

export async function refreshReconStatus(cfg: SurprisebotConfig): Promise<ReconStatus> {
  const statusPath = resolveStatusPath(cfg);
  const status = await readStatusFile(statusPath);
  if (!status || typeof status.pid !== "number") {
    return { running: false, reason: "status-file-missing" };
  }
  const pid = status.pid;
  const logPath = typeof status.logPath === "string" ? status.logPath : undefined;
  const runId = typeof status.runId === "string" ? status.runId : undefined;
  const startedAt = typeof status.startedAt === "string" ? status.startedAt : undefined;
  const finishedAt = typeof status.finishedAt === "string" ? status.finishedAt : undefined;
  const exitCode = typeof status.exitCode === "number" ? status.exitCode : undefined;
  const running =
    (await pidExists(pid)) && (await pidMatchesRecon(pid)) && (await logExists(logPath));

  const updated: ReconStatus = {
    running,
    pid,
    logPath,
    startedAt,
    runId,
    finishedAt: running ? undefined : finishedAt,
    exitCode: running ? undefined : exitCode,
    reason: running ? undefined : "pid-not-running",
  };
  await fs.promises.writeFile(statusPath, JSON.stringify(updated, null, 2) + "\n");

  if (running) {
    lastSeenRunningPid = pid;
    lastSeenRunningRunId = runId ?? null;
    lastFinishedPid = null;
    lastFinishedRunId = null;
    return updated;
  }

  const now = Date.now();
  const finishedKey = runId ? `run:${runId}` : `pid:${pid}`;
  const seenKey = lastSeenRunningRunId ? `run:${lastSeenRunningRunId}` : `pid:${lastSeenRunningPid ?? pid}`;
  if (seenKey === finishedKey && (lastFinishedRunId !== runId || lastFinishedPid !== pid)) {
    const finishedKeyForMarker = runId ? `run:${runId}` : `pid:${pid}`;
    const shouldEmit = await markReconFinishedOnce(cfg, finishedKeyForMarker);
    if (!shouldEmit) {
      return updated;
    }
    lastFinishedAtMs = now;
    lastFinishedPid = pid;
    if (runId) lastFinishedRunId = runId;
    const incident: ReconIncident = {
      id: makeIncidentId(),
      ts: new Date().toISOString(),
      source: "recon-status",
      severity: "medium",
      summary: `Recon finished (${runId ? `runId ${runId}` : `PID ${pid}`} stopped).`,
      evidence: [logPath ? `log: ${logPath}` : "log: missing"],
      meta: { pid, logPath, runId, exitCode, finishedAt },
    };
    await appendReconIncident(cfg, incident);
    const sessionKey = resolveMainSessionKey(cfg);
    enqueueSystemEvent(
      `Incident queued: recon finished (PID ${pid} stopped).`,
      { sessionKey, contextKey: `recon-finished:${pid}` },
    );
    requestHeartbeatNow({ reason: `recon-finished:${pid}`, coalesceMs: 1_000 });
  }

  return updated;
}
