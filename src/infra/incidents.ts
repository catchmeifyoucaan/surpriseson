import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import chokidar from "chokidar";
import type { SurprisebotConfig } from "../config/config.js";
import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { createSubsystemLogger } from "../logging.js";
import { enqueueSystemEvent } from "./system-events.js";
import { maybeCreateTaskFromIncident, evaluateIncidentQa } from "./mission-control/incident-tasks.js";
import { requestHeartbeatNow } from "./heartbeat-wake.js";
import { syncActiveMemoryRunningJob } from "./active-memory.js";
import { resolveMainSessionKey } from "../config/sessions.js";

export type IncidentSeverity = "low" | "medium" | "high";

export type IncidentRecord = {
  id: string;
  ts: string;
  source: string;
  severity: IncidentSeverity;
  summary: string;
  evidence?: string[];
  meta?: Record<string, unknown>;
};

type FileState = {
  size: number;
  mtimeMs: number;
  lastLowIncidentAt?: number;
  lastMediumIncidentAt?: number;
  lastErrorSignature?: string;
  lastStatusSignature?: string;
  lastResearchItemSignatures?: string[];
};

type IncidentState = {
  files: Record<string, FileState>;
};

const log = createSubsystemLogger("gateway/incidents");
const MAX_READ_BYTES = 256 * 1024;
const LOW_SEVERITY_SUPPRESS_MS = 30_000;
const ERROR_RE = /(error|fail|fatal|panic|exception|unauthorized|forbidden|denied|timeout)/i;
const HIGH_RE = /(fatal|panic|critical|segfault)/i;
const NOISY_RECON_ERROR_RE = /(ERROR: The request could not be satisfied|Config file .*\.gau\.toml not found|\bCloudFront\b.*\b403\b|\b403\b.*\bCloudFront\b)/i;
const RECON_ERROR_RE = /(ERROR:|fatal|panic|exception|timeout|unauthorized)/i;
const RESEARCH_EXPOSURE_RE = /(exposure|leak|credential|secret|key|token|password|paste|bucket|storage)/i;

function makeIncidentId(): string {
  return `inc-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function resolveWorkspaceDir(cfg: SurprisebotConfig): string {
  const agentId = resolveDefaultAgentId(cfg);
  return resolveAgentWorkspaceDir(cfg, agentId);
}

function resolveIncidentsPaths(cfg: SurprisebotConfig): {
  workspaceDir: string;
  incidentsPath: string;
  statePath: string;
} {
  const workspaceDir = resolveWorkspaceDir(cfg);
  const memoryDir = path.join(workspaceDir, "memory");
  return {
    workspaceDir,
    incidentsPath: path.join(memoryDir, "incidents.jsonl"),
    statePath: path.join(memoryDir, "incidents.state.json"),
  };
}

async function loadState(statePath: string): Promise<IncidentState> {
  try {
    const raw = await fs.promises.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as IncidentState;
    if (!parsed || typeof parsed !== "object" || !parsed.files) {
      return { files: {} };
    }
    return { files: parsed.files ?? {} };
  } catch {
    return { files: {} };
  }
}

function scheduleStateWrite(statePath: string, state: IncidentState) {
  const payload = JSON.stringify(state, null, 2);
  fs.promises
    .mkdir(path.dirname(statePath), { recursive: true })
    .then(() => fs.promises.writeFile(statePath, payload))
    .catch(() => {});
}

async function appendIncident(incidentsPath: string, incident: IncidentRecord) {
  await fs.promises.mkdir(path.dirname(incidentsPath), { recursive: true });
  await fs.promises.appendFile(incidentsPath, `${JSON.stringify(incident)}\n`);
}

async function readNewLines(filePath: string, state: IncidentState) {
  const prev = state.files[filePath]?.size ?? 0;
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return { lines: [], stat: null };
  }

  let start = prev;
  if (stat.size < prev) start = 0;
  if (stat.size === start) {
    state.files[filePath] = { ...(state.files[filePath] ?? {}), size: stat.size, mtimeMs: stat.mtimeMs };
    return { lines: [], stat };
  }

  let readStart = start;
  let readSize = stat.size - start;
  if (readSize > MAX_READ_BYTES) {
    readStart = Math.max(0, stat.size - MAX_READ_BYTES);
    readSize = stat.size - readStart;
  }

  const handle = await fs.promises.open(filePath, "r");
  const buffer = Buffer.alloc(readSize);
  await handle.read(buffer, 0, readSize, readStart);
  await handle.close();

  const text = buffer.toString("utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);

  state.files[filePath] = { ...(state.files[filePath] ?? {}), size: stat.size, mtimeMs: stat.mtimeMs };
  return { lines, stat };
}

function shouldSuppressLowSeverity(filePath: string, state: IncidentState): boolean {
  const last = state.files[filePath]?.lastLowIncidentAt ?? 0;
  return Date.now() - last < LOW_SEVERITY_SUPPRESS_MS;
}

function markLowSeverity(filePath: string, state: IncidentState) {
  const entry = state.files[filePath] ?? { size: 0, mtimeMs: 0 };
  entry.lastLowIncidentAt = Date.now();
  state.files[filePath] = entry;
}

function relPath(root: string, filePath: string) {
  return path.relative(root, filePath) || filePath;
}

function normalizeResearchString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeResearchStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function extractResearchItems(value: unknown): Array<Record<string, unknown>> {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((entry) => entry && typeof entry === "object") as Array<Record<string, unknown>>;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const listKeys = ["items", "findings", "exposures", "results", "leads", "entries"];
    for (const key of listKeys) {
      const candidate = obj[key];
      if (Array.isArray(candidate)) {
        return candidate.filter((entry) => entry && typeof entry === "object") as Array<Record<string, unknown>>;
      }
    }
    return [obj];
  }
  return [];
}

function isResearchExposure(item: Record<string, unknown>): boolean {
  const kind = normalizeResearchString(item.kind ?? item.type ?? item.category ?? item.classification ?? item.label);
  const title = normalizeResearchString(item.title ?? item.name ?? item.summary);
  const tags = normalizeResearchStringArray(item.tags ?? item.labels);
  if (kind && RESEARCH_EXPOSURE_RE.test(kind)) return true;
  if (title && RESEARCH_EXPOSURE_RE.test(title)) return true;
  if (tags.some((tag) => RESEARCH_EXPOSURE_RE.test(tag))) return true;
  return false;
}

function severityFromResearch(item: Record<string, unknown>): IncidentSeverity {
  const raw = normalizeResearchString(item.severity ?? item.priority ?? item.risk ?? item.impact);
  if (raw) {
    const lowered = raw.toLowerCase();
    if (/(critical|sev0|sev1)/.test(lowered)) return "high";
    if (/high/.test(lowered)) return "high";
    if (/(medium|moderate|sev2|sev3)/.test(lowered)) return "medium";
    if (/low/.test(lowered)) return "low";
  }
  return isResearchExposure(item) ? "medium" : "low";
}

function buildResearchEvidence(item: Record<string, unknown>): string[] {
  const evidence: string[] = [];
  const url = normalizeResearchString(item.url ?? item.link);
  const source = normalizeResearchString(item.source ?? item.origin);
  const query = normalizeResearchString(item.query ?? item.search);
  const summary = normalizeResearchString(item.summary ?? item.snippet ?? item.description);
  const tags = normalizeResearchStringArray(item.tags ?? item.labels);
  const severity = normalizeResearchString(item.severity ?? item.priority ?? item.risk ?? item.impact);
  if (url) evidence.push(`url: ${url}`);
  if (source) evidence.push(`source: ${source}`);
  if (query) evidence.push(`query: ${query}`);
  if (summary) evidence.push(`summary: ${summary}`);
  if (tags.length) evidence.push(`tags: ${tags.join(", ")}`);
  if (severity) evidence.push(`severity: ${severity}`);
  return evidence;
}

function summarizeLines(lines: string[], limit = 4): string[] {
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `...(${lines.length - limit} more)`];
}

function hashLines(lines: string[]): string {
  return crypto.createHash("sha256").update(lines.join("\n")).digest("hex");
}


function researchItemSignature(item: Record<string, unknown>): string {
  const url = normalizeResearchString(item.url ?? item.link) ?? "";
  const title = normalizeResearchString(item.title ?? item.name ?? item.summary) ?? "";
  const summary = normalizeResearchString(item.summary ?? item.snippet ?? item.description) ?? "";
  const severity = normalizeResearchString(item.severity ?? item.priority ?? item.risk ?? item.impact) ?? "";
  const kind = normalizeResearchString(item.kind ?? item.type ?? item.category ?? item.classification ?? item.label) ?? "";
  const tags = normalizeResearchStringArray(item.tags ?? item.labels).join(",");
  return hashLines([url, title, summary, severity, kind, tags]);
}


function filterReconErrors(lines: string[]): string[] {
  return lines.filter((line) => ERROR_RE.test(line) && !NOISY_RECON_ERROR_RE.test(line));
}

function severityFromLines(lines: string[]): IncidentSeverity {
  if (lines.some((line) => HIGH_RE.test(line))) return "high";
  if (lines.some((line) => ERROR_RE.test(line))) return "medium";
  return "low";
}

async function emitIncident(params: {
  cfg: SurprisebotConfig;
  incidentsPath: string;
  state: IncidentState;
  source: string;
  summary: string;
  severity: IncidentSeverity;
  evidence?: string[];
  meta?: Record<string, unknown>;
}) {
  const incident: IncidentRecord = {
    id: makeIncidentId(),
    ts: new Date().toISOString(),
    source: params.source,
    severity: params.severity,
    summary: params.summary,
    evidence: params.evidence,
    meta: params.meta,
  };
  await appendIncident(params.incidentsPath, incident);

  try {
    maybeCreateTaskFromIncident(params.cfg, incident);
  } catch {
    // ignore task creation failures to avoid blocking incident pipeline
  }

  const { qaRequired } = evaluateIncidentQa(params.cfg, incident);
  if (params.severity !== "low" && !qaRequired) {
    const sessionKey = resolveMainSessionKey(params.cfg);
    enqueueSystemEvent(`Incident queued: ${incident.summary}`, {
      sessionKey,
      contextKey: `incident:${incident.id}`,
    });
    requestHeartbeatNow({ reason: `incident:${incident.id}`, coalesceMs: 1_000 });
  }
}

async function handleLogFile(params: {
  cfg: SurprisebotConfig;
  workspaceDir: string;
  incidentsPath: string;
  state: IncidentState;
  filePath: string;
}) {
  const { lines } = await readNewLines(params.filePath, params.state);
  if (lines.length === 0) return;

  const isReconLog = params.filePath.endsWith(".log");
  const sanitizedLines = isReconLog
    ? lines.filter((line) => !NOISY_RECON_ERROR_RE.test(line))
    : lines;
  if (sanitizedLines.length === 0) return;

  const errorLines = isReconLog
    ? sanitizedLines.filter((line) => RECON_ERROR_RE.test(line))
    : sanitizedLines.filter((line) => ERROR_RE.test(line));
  const severity = isReconLog
    ? errorLines.some((line) => HIGH_RE.test(line))
      ? "high"
      : errorLines.length > 0
        ? "medium"
        : "low"
    : severityFromLines(errorLines.length ? errorLines : sanitizedLines);

  if (severity !== "low" && errorLines.length > 0) {
    const entry = params.state.files[params.filePath] ?? { size: 0, mtimeMs: 0 };
    const errorSignature = hashLines(errorLines);
    if (entry.lastErrorSignature === errorSignature) {
      return;
    }
    entry.lastErrorSignature = errorSignature;
    params.state.files[params.filePath] = entry;
  }

  if (severity === "low" && shouldSuppressLowSeverity(params.filePath, params.state)) {
    return;
  }

  const evidenceLines = errorLines.length ? errorLines : sanitizedLines;
  const evidence = summarizeLines(evidenceLines);
  const summary = `${severity === "low" ? "Log update" : "Log errors"} in ${relPath(
    params.workspaceDir,
    params.filePath,
  )} (${sanitizedLines.length} new lines)`;

  await emitIncident({
    cfg: params.cfg,
    incidentsPath: params.incidentsPath,
    state: params.state,
    source: "recon-log",
    summary,
    severity,
    evidence,
    meta: { path: relPath(params.workspaceDir, params.filePath), lines: sanitizedLines.length },
  });

  if (severity === "low") markLowSeverity(params.filePath, params.state);
}

async function handleOutputFile(params: {
  cfg: SurprisebotConfig;
  workspaceDir: string;
  incidentsPath: string;
  state: IncidentState;
  filePath: string;
}) {
  const { lines } = await readNewLines(params.filePath, params.state);
  if (lines.length === 0) return;

  const count = lines.length;
  const severity: IncidentSeverity = count >= 50 ? "medium" : "low";
  if (severity === "low" && shouldSuppressLowSeverity(params.filePath, params.state)) {
    return;
  }

  const summary = `Recon output updated: ${relPath(
    params.workspaceDir,
    params.filePath,
  )} (+${count})`;
  const evidence = summarizeLines(lines, 6);

  await emitIncident({
    cfg: params.cfg,
    incidentsPath: params.incidentsPath,
    state: params.state,
    source: "recon-output",
    summary,
    severity,
    evidence,
    meta: { path: relPath(params.workspaceDir, params.filePath), newItems: count },
  });

  if (severity === "low") markLowSeverity(params.filePath, params.state);
}

async function handleResearchOutputFile(params: {
  cfg: SurprisebotConfig;
  workspaceDir: string;
  incidentsPath: string;
  state: IncidentState;
  filePath: string;
}) {
  const ext = path.extname(params.filePath).toLowerCase();
  const isJsonl = ext === ".jsonl" || ext === ".ndjson";

  const emitResearchItem = async (item: Record<string, unknown>) => {
    const title =
      normalizeResearchString(item.title ?? item.name ?? item.summary ?? item.description) ??
      normalizeResearchString(item.url ?? item.link) ??
      "Research item";
    const signature = researchItemSignature(item);
    const entry = params.state.files[params.filePath] ?? { size: 0, mtimeMs: 0 };
    const seen = entry.lastResearchItemSignatures ?? [];
    if (seen.includes(signature)) {
      return;
    }

    const evidenceRaw = buildResearchEvidence(item);
    const url = normalizeResearchString(item.url ?? item.link);
    const runId = normalizeResearchString((item as any).runId ?? (item as any).run_id ?? (item as any).run);
    const eligibleForTask = Boolean(url) && evidenceRaw.length >= 2;

    let severity = severityFromResearch(item);
    if (!eligibleForTask && severity !== "low") {
      severity = "low";
    }
    if (severity === "low" && shouldSuppressLowSeverity(params.filePath, params.state)) {
      return;
    }

    const isExposure = isResearchExposure(item);
    const source = isExposure ? "exposure" : "research";
    const evidence = summarizeLines(evidenceRaw, 6);
    const kind = normalizeResearchString(item.kind ?? item.type ?? item.category ?? item.classification);
    const tags = normalizeResearchStringArray(item.tags ?? item.labels);

    entry.lastResearchItemSignatures = [
      ...seen.filter((value) => value !== signature),
      signature,
    ].slice(-200);
    params.state.files[params.filePath] = entry;

    await emitIncident({
      cfg: params.cfg,
      incidentsPath: params.incidentsPath,
      state: params.state,
      source,
      summary: `${isExposure ? "Exposure" : "Research lead"}: ${title}`,
      severity,
      evidence,
      meta: {
        path: relPath(params.workspaceDir, params.filePath),
        url,
        kind,
        tags,
        runId,
        evidenceCount: evidenceRaw.length,
        eligibleForTask,
      },
    });

    if (severity === "low") markLowSeverity(params.filePath, params.state);
  };

  if (isJsonl) {
    const { lines } = await readNewLines(params.filePath, params.state);
    if (lines.length === 0) return;
    const items: Array<Record<string, unknown>> = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        items.push(...extractResearchItems(parsed));
      } catch {
        // ignore unparsable lines
      }
    }
    if (items.length === 0) return;
    for (const item of items) {
      await emitResearchItem(item);
    }
    return;
  }

  let raw: string;
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(params.filePath);
    if (stat.size > MAX_READ_BYTES) {
      return;
    }
    raw = await fs.promises.readFile(params.filePath, "utf8");
  } catch {
    return;
  }

  const signature = hashLines([raw]);
  const entry = params.state.files[params.filePath] ?? { size: 0, mtimeMs: 0 };
  if (entry.lastStatusSignature === signature) {
    entry.size = stat.size;
    entry.mtimeMs = stat.mtimeMs;
    params.state.files[params.filePath] = entry;
    return;
  }
  entry.size = stat.size;
  entry.mtimeMs = stat.mtimeMs;
  entry.lastStatusSignature = signature;
  params.state.files[params.filePath] = entry;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  const items = extractResearchItems(parsed);
  if (items.length === 0) return;
  for (const item of items) {
    await emitResearchItem(item);
  }
}

async function handleTargetsFile(params: {
  cfg: SurprisebotConfig;
  workspaceDir: string;
  incidentsPath: string;
  state: IncidentState;
  filePath: string;
}) {
  const { lines } = await readNewLines(params.filePath, params.state);
  if (lines.length === 0) return;

  if (shouldSuppressLowSeverity(params.filePath, params.state)) return;

  const summary = `Recon targets updated: ${relPath(
    params.workspaceDir,
    params.filePath,
  )} (+${lines.length} lines)`;
  const evidence = summarizeLines(lines, 4);

  await emitIncident({
    cfg: params.cfg,
    incidentsPath: params.incidentsPath,
    state: params.state,
    source: "recon-targets",
    summary,
    severity: "low",
    evidence,
    meta: { path: relPath(params.workspaceDir, params.filePath), newLines: lines.length },
  });

  markLowSeverity(params.filePath, params.state);
}

async function handleStatusFile(params: {
  cfg: SurprisebotConfig;
  workspaceDir: string;
  incidentsPath: string;
  state: IncidentState;
  filePath: string;
}) {
  let raw: string;
  let stat: fs.Stats;
  try {
    raw = await fs.promises.readFile(params.filePath, "utf8");
    stat = await fs.promises.stat(params.filePath);
  } catch {
    return;
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === "object") {
      parsed = value as Record<string, unknown>;
    }
  } catch {
    return;
  }
  if (!parsed) return;

  const running = Boolean(parsed.running);
  const pid = typeof parsed.pid === "number" ? parsed.pid : undefined;
  const runId = typeof parsed.runId === "string" ? parsed.runId : undefined;
  const logPath = typeof parsed.logPath === "string" ? parsed.logPath : undefined;
  const finishedAt = typeof parsed.finishedAt === "string" ? parsed.finishedAt : undefined;
  const exitCode = typeof parsed.exitCode === "number" ? parsed.exitCode : undefined;

  await syncActiveMemoryRunningJob({
    workspaceDir: params.workspaceDir,
    running,
    pid,
    logPath,
  }).catch(() => {});

  const signature = `${running}|${pid ?? ""}|${runId ?? ""}|${finishedAt ?? ""}|${
    exitCode ?? ""
  }`;
  const entry = params.state.files[params.filePath] ?? { size: 0, mtimeMs: 0 };
  if (entry.lastStatusSignature === signature) {
    entry.size = stat.size;
    entry.mtimeMs = stat.mtimeMs;
    params.state.files[params.filePath] = entry;
    return;
  }
  entry.size = stat.size;
  entry.mtimeMs = stat.mtimeMs;
  entry.lastStatusSignature = signature;
  params.state.files[params.filePath] = entry;

  const severity: IncidentSeverity =
    !running && typeof exitCode === "number" && exitCode !== 0 ? "medium" : "low";
  if (severity === "low" && shouldSuppressLowSeverity(params.filePath, params.state)) {
    return;
  }

  const summary = running
    ? `Recon status: running${pid ? ` (PID ${pid})` : ""}.`
    : `Recon status: not running${pid ? ` (PID ${pid})` : ""}.`;
  const evidence: string[] = [`running: ${running}`];
  if (runId) evidence.push(`runId: ${runId}`);
  if (logPath) evidence.push(`logPath: ${logPath}`);
  if (typeof exitCode === "number") evidence.push(`exitCode: ${exitCode}`);
  if (finishedAt) evidence.push(`finishedAt: ${finishedAt}`);

  await emitIncident({
    cfg: params.cfg,
    incidentsPath: params.incidentsPath,
    state: params.state,
    source: "recon-status",
    summary,
    severity,
    evidence,
    meta: {
      path: relPath(params.workspaceDir, params.filePath),
      pid,
      runId,
      logPath,
      exitCode,
      finishedAt,
    },
  });

  if (severity === "low") markLowSeverity(params.filePath, params.state);
}

export function startIncidentGenerator(params: { cfg: SurprisebotConfig }) {
  const { cfg } = params;
  const { workspaceDir, incidentsPath, statePath } = resolveIncidentsPaths(cfg);

  const reconDir = path.join(workspaceDir, "recon");
  const runsDir = path.join(reconDir, "runs");
  const outputsDir = path.join(reconDir, "outputs");
  const targetsFile = path.join(reconDir, "targets.txt");
  const catalogFile = path.join(reconDir, "targets_catalog.csv");
  const statusFile = path.join(reconDir, "status.json");
  const researchDir = path.join(workspaceDir, "research");
  const researchOutputsDir = path.join(researchDir, "outputs");

  const watchPaths: string[] = [];
  if (!fs.existsSync(reconDir)) {
    log.info("incident generator disabled (no recon directory)");
  }
  if (fs.existsSync(runsDir)) watchPaths.push(path.join(runsDir, "**/*"));
  if (fs.existsSync(outputsDir)) watchPaths.push(path.join(outputsDir, "**/*"));
  if (fs.existsSync(targetsFile)) watchPaths.push(targetsFile);
  if (fs.existsSync(catalogFile)) watchPaths.push(catalogFile);
  if (fs.existsSync(reconDir)) watchPaths.push(statusFile);
  if (fs.existsSync(researchOutputsDir)) watchPaths.push(path.join(researchOutputsDir, "**/*"));

  if (watchPaths.length === 0) {
    log.info("incident generator disabled (no watch paths)");
    return { stop: () => {} };
  }

  const watcher = chokidar.watch(watchPaths, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 200 },
    usePolling: true,
    interval: 500,
    binaryInterval: 500,
  });

  let stopped = false;
  const statePromise = loadState(statePath);
  const scanIntervalMs = 5_000;
  let seeded = false;

  async function listFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          out.push(...(await listFiles(full)));
        } else if (entry.isFile()) {
          out.push(full);
        }
      }
    } catch {
      // ignore
    }
    return out;
  }

  async function scanAll() {
    if (stopped) return;
    const files: string[] = [];
    if (fs.existsSync(runsDir)) files.push(...(await listFiles(runsDir)));
    if (fs.existsSync(outputsDir)) files.push(...(await listFiles(outputsDir)));
    if (fs.existsSync(targetsFile)) files.push(targetsFile);
    if (fs.existsSync(catalogFile)) files.push(catalogFile);
    if (fs.existsSync(statusFile)) files.push(statusFile);
    if (fs.existsSync(researchOutputsDir)) files.push(...(await listFiles(researchOutputsDir)));
    const state = await statePromise;
    if (!seeded) {
      for (const filePath of files) {
        await readNewLines(filePath, state);
      }
      seeded = true;
      scheduleStateWrite(statePath, state);
      return;
    }
    for (const filePath of files) {
      await handleFile(filePath);
    }
  }

  const handleFile = async (filePath: string) => {
    if (stopped) return;
    const state = await statePromise;
    const normalized = path.resolve(filePath);
    try {
      if (normalized.startsWith(path.resolve(runsDir))) {
        await handleLogFile({ cfg, workspaceDir, incidentsPath, state, filePath: normalized });
      } else if (normalized.startsWith(path.resolve(outputsDir))) {
        await handleOutputFile({ cfg, workspaceDir, incidentsPath, state, filePath: normalized });
      } else if (normalized.startsWith(path.resolve(researchOutputsDir))) {
        await handleResearchOutputFile({ cfg, workspaceDir, incidentsPath, state, filePath: normalized });
      } else if (normalized === path.resolve(targetsFile) || normalized === path.resolve(catalogFile)) {
        await handleTargetsFile({ cfg, workspaceDir, incidentsPath, state, filePath: normalized });
      } else if (normalized === path.resolve(statusFile)) {
        await handleStatusFile({ cfg, workspaceDir, incidentsPath, state, filePath: normalized });
      }
    } catch (err) {
      log.warn(`incident generator failed for ${normalized}: ${String(err)}`);
    } finally {
      const state = await statePromise;
      scheduleStateWrite(statePath, state);
    }
  };

  watcher.on("add", handleFile);
  watcher.on("change", handleFile);

  log.info(`incident generator watching ${watchPaths.length} path(s)`);
  void scanAll();
  const intervalTimer = setInterval(() => {
    void scanAll();
  }, scanIntervalMs);

  const stop = () => {
    stopped = true;
    void watcher.close().catch(() => {});
    clearInterval(intervalTimer);
  };

  return { stop };
}
