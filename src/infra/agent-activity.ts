import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { inferToolMetaFromArgs } from "../agents/pi-embedded-utils.js";
import type { SurprisebotConfig } from "../config/config.js";
import {
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  resolveSessionAgentId,
} from "../agents/agent-scope.js";
import {
  DEFAULT_MEMORY_ACTIVE_FILENAME,
  resolveDefaultAgentWorkspaceDir,
} from "../agents/workspace.js";
import { getAgentRunContext, onAgentEvent } from "./agent-events.js";

type ActivityEvent = {
  ts: number;
  kind: "tool" | "lifecycle" | "error";
  text: string;
  runId?: string;
};

type ActiveTool = {
  runId: string;
  toolCallId: string;
  toolName: string;
  meta?: string;
  startedAt: number;
  lastUpdateAt?: number;
};

type AgentState = {
  activeTools: Map<string, ActiveTool>;
  recentEvents: ActivityEvent[];
};

const MAX_RECENT_EVENTS = 120;
const MAX_ACTIVE_TOOLS = 50;
const FLUSH_DELAY_MS = 1500;
const MAX_EVENT_AGE_MS = 2 * 60 * 60 * 1000;
const SKILL_DESCRIPTION_PATH_RE =
  /failed to load skill ([^:]+): invalid YAML: missing field `description`/i;
const SKILL_DESCRIPTION_NAME_RE =
  /failed to load ([A-Za-z0-9._-]+) SKILL\.md.*missing (?:field `description`|description)/i;
const ERROR_COOLDOWN_MS = 30 * 60 * 1000;


function resolveSafeSkillRoots(cfg: SurprisebotConfig | null): string[] {
  const roots = new Set<string>();
  const envRoots = (process.env.SURPRISEBOT_SKILLS_ROOTS ?? "")
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter(Boolean);
  for (const root of envRoots) {
    roots.add(path.resolve(root));
  }

  if (cfg?.skills?.load?.extraDirs) {
    for (const dir of cfg.skills.load.extraDirs) {
      if (!dir || typeof dir !== "string") continue;
      roots.add(path.resolve(dir));
    }
  }

  const defaultWorkspace = resolveDefaultAgentWorkspaceDir();
  const workspace = (cfg?.agents?.defaults?.workspace && typeof cfg.agents.defaults.workspace === "string")
    ? cfg.agents.defaults.workspace
    : defaultWorkspace;
  if (workspace) {
    roots.add(path.resolve(workspace, "skills"));
  }

  const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
  roots.add(path.resolve(codexHome));

  return [...roots];
}

const TOKEN_PATTERNS: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9]{10,}/g, "sk-***"],
  [/AIzaSy[A-Za-z0-9_\-]{10,}/g, "AIzaSy***"],
  [/pplx-[A-Za-z0-9]{8,}/g, "pplx-***"],
  [/xox[baprs]-[A-Za-z0-9-]{8,}/g, "xox***"],
];

const agentStates = new Map<string, AgentState>();
let flushTimer: NodeJS.Timeout | null = null;
let pendingFlush = false;
let activeConfig: SurprisebotConfig | null = null;
let defaultAgentId: string | null = null;
const recentErrorCache = new Map<string, number>();

function sanitize(text: string | undefined): string | undefined {
  if (!text) return text;
  let out = text.replace(/\s+/g, " ").trim();
  for (const [pattern, replacement] of TOKEN_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  if (out.length > 240) out = `${out.slice(0, 237)}...`;
  return out;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toISOString().replace("T", " ").replace("Z", "Z");
}

function getAgentState(agentId: string): AgentState {
  const existing = agentStates.get(agentId);
  if (existing) return existing;
  const state: AgentState = { activeTools: new Map(), recentEvents: [] };
  agentStates.set(agentId, state);
  return state;
}

function addEvent(agentId: string, evt: ActivityEvent) {
  const state = getAgentState(agentId);
  const cutoff = evt.ts - MAX_EVENT_AGE_MS;
  if (Number.isFinite(cutoff)) {
    state.recentEvents = state.recentEvents.filter((entry) => entry.ts >= cutoff);
  }
  const last = state.recentEvents[state.recentEvents.length - 1];
  if (last && last.kind === evt.kind && last.text === evt.text) return;
  state.recentEvents.push(evt);
  while (state.recentEvents.length > MAX_RECENT_EVENTS) state.recentEvents.shift();
}

function scheduleFlush() {
  pendingFlush = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushAllActiveFiles();
  }, FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

function renderActiveSection(state: AgentState): string {
  const lines: string[] = [];
  lines.push("<!-- AUTO-GENERATED: START -->");
  lines.push("# Active Tasks (auto)");
  if (state.activeTools.size === 0) {
    lines.push("- none");
  } else {
    const now = Date.now();
    const entries = [...state.activeTools.values()]
      .sort((a, b) => a.startedAt - b.startedAt)
      .slice(0, MAX_ACTIVE_TOOLS);
    for (const entry of entries) {
      const elapsedSec = Math.max(1, Math.floor((now - entry.startedAt) / 1000));
      const meta = entry.meta ? ` | ${entry.meta}` : "";
      lines.push(
        `- ${entry.toolName} (${entry.toolCallId}) — ${elapsedSec}s${meta}`,
      );
    }
  }

  lines.push("\n# Recent Events (auto)");
  if (state.recentEvents.length === 0) {
    lines.push("- none");
  } else {
    for (const evt of state.recentEvents.slice(-30)) {
      const run = evt.runId ? ` [${evt.runId}]` : "";
      lines.push(`- ${formatTime(evt.ts)}${run} ${evt.text}`);
    }
  }
  lines.push("<!-- AUTO-GENERATED: END -->");
  return lines.join("\n");
}

async function flushActiveFile(agentId: string, state: AgentState, workspace: string) {
  if (!pendingFlush) return;
  const filePath = path.join(workspace, DEFAULT_MEMORY_ACTIVE_FILENAME);
  let existing = "";
  try {
    existing = await fs.readFile(filePath, "utf8");
  } catch {
    existing = "";
  }

  const autoSection = renderActiveSection(state);
  const start = existing.indexOf("<!-- AUTO-GENERATED: START -->");
  const end = existing.indexOf("<!-- AUTO-GENERATED: END -->");
  let next = "";
  if (start !== -1 && end !== -1 && end > start) {
    next = `${existing.slice(0, start)}${autoSection}${existing.slice(end + "<!-- AUTO-GENERATED: END -->".length)}`;
  } else if (existing.trim()) {
    next = `${autoSection}\n\n${existing.trim()}\n`;
  } else {
    next = `${autoSection}\n\n# Manual Notes\n- add notes here\n`;
  }
  await fs.writeFile(filePath, `${next.trim()}\n`, "utf8");
}

async function flushAllActiveFiles() {
  if (!pendingFlush) return;
  pendingFlush = false;
  const cfg = activeConfig;
  if (!cfg) return;
  const fallbackWorkspace = resolveDefaultAgentWorkspaceDir();
  for (const [agentId, state] of agentStates.entries()) {
    const workspace = resolveAgentWorkspaceDir(cfg, agentId) || fallbackWorkspace;
    await flushActiveFile(agentId, state, workspace);
  }
}

function isSafeSkillPath(filePath: string): boolean {
  if (!path.isAbsolute(filePath)) return false;
  if (!filePath.endsWith("SKILL.md")) return false;
  const normalized = path.normalize(filePath);
  const roots = resolveSafeSkillRoots(activeConfig);
  return roots.some((root) => normalized === root || normalized.startsWith(`${root}${path.sep}`));
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findSkillPathByName(skillName: string): Promise<string | null> {
  const normalized = skillName.trim();
  if (!normalized) return null;
  const roots = resolveSafeSkillRoots(activeConfig);
  for (const root of roots) {
    const direct = path.join(root, normalized, "SKILL.md");
    if (await fileExists(direct)) return direct;
  }
  const maxDepth = 4;
  for (const root of roots) {
    const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      if (current.depth > maxDepth) continue;
      let entries: Array<Dirent> = [];
      try {
        entries = await fs.readdir(current.dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const nextDir = path.join(current.dir, entry.name);
        if (entry.name === normalized) {
          const candidate = path.join(nextDir, "SKILL.md");
          if (await fileExists(candidate)) return candidate;
        }
        if (current.depth < maxDepth) {
          queue.push({ dir: nextDir, depth: current.depth + 1 });
        }
      }
    }
  }
  return null;
}

function ensureSkillDescription(content: string): { next: string; changed: boolean } {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return { next: content, changed: false };
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) return { next: content, changed: false };
  const block = normalized.slice(4, endIndex);
  if (/^description:\s*/im.test(block)) return { next: content, changed: false };
  const lines = block.split("\n");
  const nameLine = lines.find((line) => /^name:\s*/i.test(line));
  const summaryLine = lines.find((line) => /^summary:\s*/i.test(line));
  const summaryValue = summaryLine ? summaryLine.replace(/^summary:\s*/i, "").trim() : "";
  const nameValue = nameLine ? nameLine.replace(/^name:\s*/i, "").trim() : "";
  const description = summaryValue || nameValue || "Skill instructions.";
  const nameIndex = lines.findIndex((line) => /^name:\s*/i.test(line));
  const insertAt = nameIndex >= 0 ? nameIndex + 1 : 0;
  lines.splice(insertAt, 0, `description: ${description}`);
  const nextBlock = lines.join("\n");
  const next = `${normalized.slice(0, 4)}${nextBlock}${normalized.slice(endIndex)}`;
  return { next, changed: true };
}

async function maybeAutoFixSkillDescription(errorText: string): Promise<string | null> {
  let filePath: string | null = null;
  const pathMatch = errorText.match(SKILL_DESCRIPTION_PATH_RE);
  if (pathMatch?.[1]) {
    filePath = pathMatch[1].trim();
  } else {
    const nameMatch = errorText.match(SKILL_DESCRIPTION_NAME_RE);
    if (nameMatch?.[1]) {
      filePath = await findSkillPathByName(nameMatch[1].trim());
    }
  }
  if (!filePath || !isSafeSkillPath(filePath)) return null;
  let content = "";
  try {
    content = await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
  const { next, changed } = ensureSkillDescription(content);
  if (!changed) return null;
  try {
    await fs.writeFile(filePath, next, "utf8");
  } catch {
    return null;
  }
  const shortName = path.basename(path.dirname(filePath)) || path.basename(filePath);
  return `auto-fix: added description to ${shortName}/SKILL.md`;
}

function shouldSuppressError(agentId: string, error: string): boolean {
  const normalized = sanitize(error) ?? "unknown error";
  const key = `${agentId}:${normalized}`;
  const now = Date.now();
  const lastSeen = recentErrorCache.get(key);
  if (typeof lastSeen === "number" && now - lastSeen < ERROR_COOLDOWN_MS) {
    return true;
  }
  recentErrorCache.set(key, now);
  return false;
}

async function handleErrorEvent(params: {
  agentId: string;
  runId?: string;
  error: string;
}) {
  const fixMessage = await maybeAutoFixSkillDescription(params.error);
  if (fixMessage) {
    addEvent(params.agentId, {
      ts: Date.now(),
      kind: "error",
      runId: params.runId,
      text: fixMessage,
    });
    scheduleFlush();
    return;
  }
  if (shouldSuppressError(params.agentId, params.error)) return;
  addEvent(params.agentId, {
    ts: Date.now(),
    kind: "error",
    runId: params.runId,
    text: `run error: ${sanitize(params.error)}`,
  });
  scheduleFlush();
}

export function startAgentActivityTracker(cfg: SurprisebotConfig): () => void {
  activeConfig = cfg;
  defaultAgentId = resolveDefaultAgentId(cfg);
  const unsubscribe = onAgentEvent((evt) => {
    const runId = evt.runId;
    const context = getAgentRunContext(runId);
    const sessionKey = context?.sessionKey;
    const agentId = resolveSessionAgentId({ sessionKey, config: cfg }) || defaultAgentId || "default";
    if (evt.stream === "tool") {
      const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
      const toolName = typeof evt.data.name === "string" ? evt.data.name : "tool";
      const toolCallId =
        typeof evt.data.toolCallId === "string" ? evt.data.toolCallId : "unknown";
      const key = `${runId}:${toolCallId}`;
      if (phase === "start") {
        const metaRaw = inferToolMetaFromArgs(toolName, evt.data.args ?? {});
        const meta = sanitize(metaRaw);
        const state = getAgentState(agentId);
        state.activeTools.set(key, {
          runId,
          toolCallId,
          toolName,
          meta,
          startedAt: evt.ts,
        });
        addEvent(agentId, {
          ts: evt.ts,
          kind: "tool",
          runId,
          text: `tool start: ${toolName}${meta ? ` (${meta})` : ""}`,
        });
        scheduleFlush();
        return;
      }
      if (phase === "update") {
        const state = getAgentState(agentId);
        const entry = state.activeTools.get(key);
        if (entry) {
          entry.lastUpdateAt = evt.ts;
          state.activeTools.set(key, entry);
          scheduleFlush();
        }
        return;
      }
      if (phase === "end") {
        const state = getAgentState(agentId);
        state.activeTools.delete(key);
        addEvent(agentId, {
          ts: evt.ts,
          kind: "tool",
          runId,
          text: `tool end: ${toolName}`,
        });
        scheduleFlush();
        return;
      }
    }

    if (evt.stream === "lifecycle") {
      const phase = typeof evt.data.phase === "string" ? evt.data.phase : "";
      if (phase === "start") {
        const label = context?.sessionKey ? ` (${context.sessionKey})` : "";
        addEvent(agentId, {
          ts: evt.ts,
          kind: "lifecycle",
          runId,
          text: `run start${label}`,
        });
        scheduleFlush();
        return;
      }
      if (phase === "end") {
        addEvent(agentId, {
          ts: evt.ts,
          kind: "lifecycle",
          runId,
          text: "run end",
        });
        scheduleFlush();
        return;
      }
      if (phase === "error") {
        const error = typeof evt.data.error === "string" ? evt.data.error : "unknown error";
        void handleErrorEvent({ agentId, runId, error });
      }
    }

    if (evt.stream === "error") {
      const error = typeof evt.data.error === "string" ? evt.data.error : "unknown error";
      void handleErrorEvent({ agentId, runId, error });
    }
  });

  return () => {
    unsubscribe();
  };
}
