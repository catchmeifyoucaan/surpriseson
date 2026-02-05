import fs from "node:fs/promises";
import path from "node:path";

import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { ensureSharedMemoryForWorkspace, resolveSharedMemorySettings } from "../../agents/shared-memory.js";
import { logVerbose } from "../../globals.js";
import type { CommandHandler } from "./commands-types.js";

type MemoryAction = "remember" | "forget" | "prefer" | "deprecate" | "decide" | "active";
type MemoryTarget = "profile" | "preference" | "decision" | "active" | "note";
type MemoryForgetPolicy = "hard" | "deprecate";

type ParsedMemoryCommand = {
  action: MemoryAction;
  target: MemoryTarget;
  text: string;
};

export type MemoryCommandResult = {
  message: string;
  updated: string[];
};

const ACTIONS: MemoryAction[] = [
  "remember",
  "forget",
  "prefer",
  "deprecate",
  "decide",
  "active",
];

const TARGETS = new Set<MemoryTarget>([
  "profile",
  "preference",
  "decision",
  "active",
  "note",
]);

const DEFAULT_TARGET: Record<MemoryAction, MemoryTarget> = {
  remember: "profile",
  forget: "profile",
  prefer: "preference",
  deprecate: "decision",
  decide: "decision",
  active: "active",
};

const SHARED_REVIEW_ALIASES = new Set([
  "/shared-review",
  "/shared_review",
  "/shared-merge",
  "/shared_merge",
]);

const APPROVED_MARKER_RE = /^\s*[-*]?\s*\[\s*APPROVED\s*\]/i;

type SharedReviewArgs = {
  dryRun: boolean;
};

function parseSharedReviewCommand(body: string): SharedReviewArgs | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.split(/\s+/);
  const command = (parts.shift() ?? "").toLowerCase();
  if (!SHARED_REVIEW_ALIASES.has(command)) return null;
  const tokens = parts.map((p) => p.toLowerCase());
  const dryRun =
    tokens.includes("--dry-run") || tokens.includes("dry-run") || tokens.includes("dry");
  return { dryRun };
}

function normalizeLine(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function extractApprovedLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (!APPROVED_MARKER_RE.test(trimmed)) return null;
  let cleaned = trimmed.replace(/^\s*[-*]?\s*\[\s*APPROVED\s*\]\s*/i, "");
  cleaned = cleaned.replace(/^[-*]\s*/, "");
  cleaned = cleaned.replace(/^[:\-]\s*/, "");
  cleaned = cleaned.trim();
  if (!cleaned) return null;
  if (!cleaned.startsWith("-")) cleaned = `- ${cleaned}`;
  return cleaned;
}

function isSharedWriteAllowed(cfg: any, agentId?: string): {
  allowed: boolean;
  settings: ReturnType<typeof resolveSharedMemorySettings> | null;
  agentId: string;
} {
  const resolvedAgentId = (agentId ?? resolveDefaultAgentId(cfg)).trim();
  const settings = resolveSharedMemorySettings({ cfg, agentId: resolvedAgentId });
  if (!settings) {
    return { allowed: true, settings: null, agentId: resolvedAgentId };
  }
  const allowList = settings.allowWriteAgents
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const defaultAgentId = resolveDefaultAgentId(cfg).trim().toLowerCase();
  const normalized = resolvedAgentId.toLowerCase();
  const allowed =
    allowList.length > 0 ? allowList.includes(normalized) : normalized === defaultAgentId;
  return { allowed, settings, agentId: resolvedAgentId };
}

const DEFAULT_PROFILE_TEMPLATE = `# Profile
- Name:
- Role:
- Constraints:

## Preferences
- (add current preferences here)

## Notes
- (durable notes)
`;

const DEFAULT_PREFERENCES_TEMPLATE = `# Preference History
- YYYY-MM-DD PREF-YYYYMMDD-1 [ACTIVE]: (preference)
`;

const DEFAULT_DECISIONS_TEMPLATE = `# Decisions
- YYYY-MM-DD DEC-YYYYMMDD-1: (decision + rationale)
`;

const DEFAULT_ACTIVE_TEMPLATE = `# Active
- Current goals and next steps
`;

const DECISION_ID_RE = /DEC-\d{8}-\d+/i;
const PREFERENCE_ID_RE = /PREF-\d{8}-\d+/i;

export const handleSharedMemoryReviewCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) return null;
  const parsed = parseSharedReviewCommand(params.command.commandBodyNormalized);
  if (!parsed) return null;
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring shared memory review from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (params.cfg.commands?.memory !== true) {
    return {
      shouldContinue: false,
      reply: { text: "⚠️ Memory commands are disabled. Set commands.memory=true to enable." },
    };
  }

  const permission = isSharedWriteAllowed(params.cfg, params.agentId);
  if (!permission.settings) {
    return {
      shouldContinue: false,
      reply: { text: "⚠️ Shared memory is disabled." },
    };
  }
  if (!permission.allowed) {
    return {
      shouldContinue: false,
      reply: { text: "⚠️ Only the core agent can merge shared memory." },
    };
  }

  try {
    await ensureSharedMemoryForWorkspace({
      cfg: params.cfg,
      agentId: permission.agentId,
      workspaceDir: params.workspaceDir,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logVerbose(`Shared memory bootstrap failed: ${message}`);
  }

  const sharedPath = permission.settings.path;
  const pendingPath = permission.settings.pendingPath;
  if (!pendingPath) {
    return {
      shouldContinue: false,
      reply: { text: "⚠️ Shared memory pending path is not configured." },
    };
  }

  let pendingText = "";
  try {
    pendingText = await fs.readFile(pendingPath, "utf8");
  } catch {
    return {
      shouldContinue: false,
      reply: { text: "⚠️ No shared pending file found." },
    };
  }

  const lines = pendingText.split(/\r?\n/);
  const approved: string[] = [];
  const remaining: string[] = [];
  for (const line of lines) {
    const cleaned = extractApprovedLine(line);
    if (cleaned) {
      approved.push(cleaned);
    } else {
      remaining.push(line);
    }
  }

  if (approved.length === 0) {
    return {
      shouldContinue: false,
      reply: { text: "No approved entries found in shared.pending.md. Mark lines with [APPROVED] first." },
    };
  }

  let sharedText = "";
  try {
    sharedText = await fs.readFile(sharedPath, "utf8");
  } catch {
    sharedText = "";
  }

  const existing = new Set(
    sharedText
      .split(/\r?\n/)
      .map(normalizeLine)
      .filter((v) => v),
  );

  const merged: string[] = [];
  let duplicates = 0;
  for (const line of approved) {
    const normalized = normalizeLine(line);
    if (!normalized) continue;
    if (existing.has(normalized)) {
      duplicates += 1;
      continue;
    }
    existing.add(normalized);
    merged.push(line);
  }

  if (!parsed.dryRun) {
    if (merged.length > 0) {
      const base = sharedText.trimEnd();
      const mergedBlock = merged.join("\n");
      const next = base ? `${base}\n${mergedBlock}\n` : `${mergedBlock}\n`;
      await fs.mkdir(path.dirname(sharedPath), { recursive: true });
      await fs.writeFile(sharedPath, next, "utf8");
    }

    const nextPending = `${remaining.join("\n").trimEnd()}\n`;
    await fs.writeFile(pendingPath, nextPending, "utf8");
  }

  const dry = parsed.dryRun ? " (dry-run)" : "";
  const msg = `Shared review${dry}: merged ${merged.length}, skipped duplicates ${duplicates}, approved ${approved.length}.`;
  return { shouldContinue: false, reply: { text: msg } };
};

export const handleMemoryCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) return null;
  const parsed = parseMemoryCommand(params.command.commandBodyNormalized);
  if (!parsed) return null;
  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /${parsed.action} from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }
  if (params.cfg.commands?.memory !== true) {
    return {
      shouldContinue: false,
      reply: { text: "⚠️ Memory commands are disabled. Set commands.memory=true to enable." },
    };
  }

  const forgetPolicy = params.cfg.commands?.memoryForgetPolicy ?? "hard";
  try {
    const result = await applyMemoryAction({
      workspaceDir: params.workspaceDir,
      action: parsed.action,
      target: parsed.target,
      text: parsed.text,
      forgetPolicy,
    });
    return { shouldContinue: false, reply: { text: result.message } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { shouldContinue: false, reply: { text: `⚠️ Memory update failed: ${message}` } };
  }
};

export async function applyMemoryAction(params: {
  workspaceDir: string;
  action: MemoryAction;
  target: MemoryTarget;
  text: string;
  forgetPolicy?: MemoryForgetPolicy;
}): Promise<MemoryCommandResult> {
  const now = new Date();
  const date = formatDate(now);
  const dateKey = date.replace(/-/g, "");
  const forgetPolicy = params.forgetPolicy ?? "hard";
  const memoryDir = path.join(params.workspaceDir, "memory");
  await fs.mkdir(memoryDir, { recursive: true });

  const profilePath = path.join(memoryDir, "profile.md");
  const preferencesPath = path.join(memoryDir, "preferences.md");
  const decisionsPath = path.join(memoryDir, "decisions.md");
  const activePath = path.join(memoryDir, "active.md");
  const dailyPath = path.join(memoryDir, `${date}.md`);

  if (!params.text.trim()) {
    throw new Error(`Usage: /${params.action} <text>`);
  }

  if (params.action === "remember") {
    if (params.target === "preference") {
      return applyPreference({
        date,
        dateKey,
        text: params.text,
        profilePath,
        preferencesPath,
      });
    }
    if (params.target === "decision") {
      return applyDecision({
        date,
        dateKey,
        text: params.text,
        decisionsPath,
      });
    }
    if (params.target === "active") {
      return applyActive({
        date,
        text: params.text,
        activePath,
      });
    }
    if (params.target === "note") {
      await appendLine({
        filePath: dailyPath,
        line: `- ${params.text}`,
        template: `# ${date}\n`,
      });
      return { message: "🧠 Stored daily note.", updated: [dailyPath] };
    }
    await appendToSection({
      filePath: profilePath,
      template: DEFAULT_PROFILE_TEMPLATE,
      section: "Notes",
      line: `- ${date}: ${params.text}`,
    });
    return { message: "🧠 Added note to memory profile.", updated: [profilePath] };
  }

  if (params.action === "prefer") {
    return applyPreference({
      date,
      dateKey,
      text: params.text,
      profilePath,
      preferencesPath,
    });
  }

  if (params.action === "decide") {
    return applyDecision({
      date,
      dateKey,
      text: params.text,
      decisionsPath,
    });
  }

  if (params.action === "active") {
    return applyActive({
      date,
      text: params.text,
      activePath,
    });
  }

  if (params.action === "deprecate") {
    return applyDeprecation({
      date,
      text: params.text,
      target: params.target,
      profilePath,
      preferencesPath,
      decisionsPath,
      activePath,
    });
  }

  if (params.action === "forget") {
    return applyForget({
      date,
      text: params.text,
      target: params.target,
      forgetPolicy,
      profilePath,
      preferencesPath,
      decisionsPath,
      activePath,
      dailyPath,
    });
  }

  return { message: "⚠️ Unsupported memory command.", updated: [] };
}

function parseMemoryCommand(body: string): ParsedMemoryCommand | null {
  const trimmed = body.trim();
  for (const action of ACTIONS) {
    const prefix = `/${action}`;
    if (trimmed === prefix || trimmed.startsWith(`${prefix} `)) {
      const rest = trimmed.slice(prefix.length).trim();
      if (!rest) {
        return {
          action,
          target: DEFAULT_TARGET[action],
          text: "",
        };
      }
      const tokens = rest.split(/\s+/).filter(Boolean);
      let target = DEFAULT_TARGET[action];
      if (tokens.length > 1 && TARGETS.has(tokens[0].toLowerCase() as MemoryTarget)) {
        target = tokens.shift()!.toLowerCase() as MemoryTarget;
      }
      return {
        action,
        target,
        text: tokens.join(" "),
      };
    }
  }
  return null;
}

async function applyPreference(params: {
  date: string;
  dateKey: string;
  text: string;
  profilePath: string;
  preferencesPath: string;
}): Promise<MemoryCommandResult> {
  const preferences = await readOrInit(params.preferencesPath, DEFAULT_PREFERENCES_TEMPLATE);
  const prefId = nextId(preferences, `PREF-${params.dateKey}-`);
  const line = `- ${params.date} ${prefId} [ACTIVE]: ${params.text}`;
  const drift = await deprecatePreferenceDrift({
    date: params.date,
    prefId,
    text: params.text,
    profilePath: params.profilePath,
    preferencesPath: params.preferencesPath,
  });
  await appendLine({
    filePath: params.preferencesPath,
    line,
    template: DEFAULT_PREFERENCES_TEMPLATE,
  });

  await appendToSection({
    filePath: params.profilePath,
    template: DEFAULT_PROFILE_TEMPLATE,
    section: "Preferences",
    line: `- ${params.text} (${prefId}, since ${params.date})`,
  });

  return {
    message: `🧠 Preference recorded (${prefId}).`,
    updated: [
      params.preferencesPath,
      params.profilePath,
      ...(drift.updatedFiles ?? []),
    ],
  };
}

async function deprecatePreferenceDrift(params: {
  date: string;
  prefId: string;
  text: string;
  profilePath: string;
  preferencesPath: string;
}): Promise<{ updatedFiles: string[] }> {
  const content = await readOrInit(params.preferencesPath, DEFAULT_PREFERENCES_TEMPLATE);
  const lines = content.split(/\r?\n/);
  const targetKey = normalizePreferenceKey(params.text);
  const deprecatedTexts: string[] = [];
  let changed = false;

  const updatedLines = lines.map((line) => {
    const parsed = parsePreferenceLine(line);
    if (!parsed || parsed.status !== "active") return line;
    if (parsed.id === params.prefId) return line;
    const candidateKey = normalizePreferenceKey(parsed.text);
    if (!isPreferenceDriftMatch(candidateKey, targetKey)) return line;
    if (line.includes("DEPRECATED")) return line;
    changed = true;
    deprecatedTexts.push(parsed.text);
    return `${line} [DEPRECATED ${params.date}; superseded by ${params.prefId}]`;
  });

  const updatedFiles: string[] = [];
  if (changed) {
    await fs.writeFile(params.preferencesPath, `${updatedLines.join("\n").trimEnd()}\n`, "utf8");
    updatedFiles.push(params.preferencesPath);
    for (const text of deprecatedTexts) {
      const removed = await removeMatchingBullets(params.profilePath, text);
      if (removed > 0) updatedFiles.push(params.profilePath);
    }
  }
  return { updatedFiles };
}

async function applyDecision(params: {
  date: string;
  dateKey: string;
  text: string;
  decisionsPath: string;
}): Promise<MemoryCommandResult> {
  const decisions = await readOrInit(params.decisionsPath, DEFAULT_DECISIONS_TEMPLATE);
  const decisionId = nextId(decisions, `DEC-${params.dateKey}-`);
  const line = `- ${params.date} ${decisionId}: ${params.text}`;
  await appendLine({
    filePath: params.decisionsPath,
    line,
    template: DEFAULT_DECISIONS_TEMPLATE,
  });
  return {
    message: `🧠 Decision recorded (${decisionId}).`,
    updated: [params.decisionsPath],
  };
}

async function applyActive(params: {
  date: string;
  text: string;
  activePath: string;
}): Promise<MemoryCommandResult> {
  const line = `- ${params.date}: ${params.text}`;
  await appendLine({
    filePath: params.activePath,
    line,
    template: DEFAULT_ACTIVE_TEMPLATE,
  });
  return { message: "🧠 Added active focus item.", updated: [params.activePath] };
}

async function applyDeprecation(params: {
  date: string;
  text: string;
  target: MemoryTarget;
  profilePath: string;
  preferencesPath: string;
  decisionsPath: string;
  activePath: string;
}): Promise<MemoryCommandResult> {
  const updated: string[] = [];
  if (params.target === "preference") {
    const { changed, message } = await deprecateInFile({
      filePath: params.preferencesPath,
      template: DEFAULT_PREFERENCES_TEMPLATE,
      date: params.date,
      text: params.text,
      idRegex: PREFERENCE_ID_RE,
    });
    if (changed) updated.push(params.preferencesPath);
    const removed = await removeMatchingBullets(params.profilePath, params.text);
    if (removed > 0) updated.push(params.profilePath);
    return {
      message: message ?? "⚠️ Preference not found to deprecate.",
      updated,
    };
  }

  if (params.target === "decision") {
    const { changed, message } = await deprecateInFile({
      filePath: params.decisionsPath,
      template: DEFAULT_DECISIONS_TEMPLATE,
      date: params.date,
      text: params.text,
      idRegex: DECISION_ID_RE,
    });
    if (changed) updated.push(params.decisionsPath);
    return {
      message: message ?? "⚠️ Decision not found to deprecate.",
      updated,
    };
  }

  const changedProfile = await markDeprecatedBullets(params.profilePath, params.text, params.date);
  const changedActive = await markDeprecatedBullets(params.activePath, params.text, params.date);
  if (changedProfile > 0) updated.push(params.profilePath);
  if (changedActive > 0) updated.push(params.activePath);
  if (updated.length === 0) {
    return { message: "⚠️ Nothing matched to deprecate.", updated };
  }
  return { message: "🧠 Deprecated matching items.", updated };
}

async function applyForget(params: {
  date: string;
  text: string;
  target: MemoryTarget;
  forgetPolicy: MemoryForgetPolicy;
  profilePath: string;
  preferencesPath: string;
  decisionsPath: string;
  activePath: string;
  dailyPath: string;
}): Promise<MemoryCommandResult> {
  if (params.forgetPolicy === "deprecate" && params.target !== "note") {
    return applyDeprecation({
      date: params.date,
      text: params.text,
      target: params.target,
      profilePath: params.profilePath,
      preferencesPath: params.preferencesPath,
      decisionsPath: params.decisionsPath,
      activePath: params.activePath,
    });
  }
  if (DECISION_ID_RE.test(params.text)) {
    return applyDeprecation({
      date: params.date,
      text: params.text,
      target: "decision",
      profilePath: params.profilePath,
      preferencesPath: params.preferencesPath,
      decisionsPath: params.decisionsPath,
      activePath: params.activePath,
    });
  }
  if (PREFERENCE_ID_RE.test(params.text)) {
    return applyDeprecation({
      date: params.date,
      text: params.text,
      target: "preference",
      profilePath: params.profilePath,
      preferencesPath: params.preferencesPath,
      decisionsPath: params.decisionsPath,
      activePath: params.activePath,
    });
  }

  const updated: string[] = [];
  if (params.target === "preference") {
    const removedPreferences = await removeMatchingBullets(params.preferencesPath, params.text);
    const removedProfile = await removeMatchingBullets(params.profilePath, params.text);
    if (removedPreferences > 0) updated.push(params.preferencesPath);
    if (removedProfile > 0) updated.push(params.profilePath);
  } else if (params.target === "decision") {
    const removedDecisions = await removeMatchingBullets(params.decisionsPath, params.text);
    if (removedDecisions > 0) updated.push(params.decisionsPath);
  } else if (params.target === "active") {
    const removedActive = await removeMatchingBullets(params.activePath, params.text);
    if (removedActive > 0) updated.push(params.activePath);
  } else if (params.target === "note") {
    const removedDaily = await removeMatchingBullets(params.dailyPath, params.text);
    if (removedDaily > 0) updated.push(params.dailyPath);
  } else {
    const removedProfile = await removeMatchingBullets(params.profilePath, params.text);
    if (removedProfile > 0) updated.push(params.profilePath);
  }

  if (updated.length === 0) {
    return { message: "⚠️ Nothing matched to forget.", updated };
  }
  return { message: "🧠 Removed matching memory entries.", updated };
}

async function readOrInit(filePath: string, template: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== "ENOENT") throw err;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, template, "utf8");
    return template;
  }
}

async function appendLine(params: { filePath: string; line: string; template: string }) {
  const content = await readOrInit(params.filePath, params.template);
  const updated = `${content.trimEnd()}\n${params.line}\n`;
  await fs.writeFile(params.filePath, updated, "utf8");
}

async function appendToSection(params: {
  filePath: string;
  template: string;
  section: string;
  line: string;
}) {
  const content = await readOrInit(params.filePath, params.template);
  const lines = content.split(/\r?\n/);
  const headerRe = new RegExp(`^#{1,6}\\s+${escapeRegExp(params.section)}\\s*$`, "i");
  let headerIndex = lines.findIndex((line) => headerRe.test(line));
  if (headerIndex === -1) {
    const updated = `${content.trimEnd()}\n\n## ${params.section}\n${params.line}\n`;
    await fs.writeFile(params.filePath, updated, "utf8");
    return;
  }
  let insertAt = lines.length;
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s+/.test(lines[i])) {
      insertAt = i;
      break;
    }
  }
  lines.splice(insertAt, 0, params.line);
  await fs.writeFile(params.filePath, `${lines.join("\n").trimEnd()}\n`, "utf8");
}

async function removeMatchingBullets(filePath: string, needle: string): Promise<number> {
  const content = await readOrInit(filePath, "");
  if (!content.trim()) return 0;
  const target = needle.toLowerCase();
  const lines = content.split(/\r?\n/);
  let removed = 0;
  const filtered = lines.filter((line) => {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("-")) return true;
    if (!line.toLowerCase().includes(target)) return true;
    removed += 1;
    return false;
  });
  if (removed > 0) {
    await fs.writeFile(filePath, `${filtered.join("\n").trimEnd()}\n`, "utf8");
  }
  return removed;
}

async function markDeprecatedBullets(
  filePath: string,
  needle: string,
  date: string,
): Promise<number> {
  const content = await readOrInit(filePath, "");
  if (!content.trim()) return 0;
  const target = needle.toLowerCase();
  const lines = content.split(/\r?\n/);
  let changed = 0;
  const updated = lines.map((line) => {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("-")) return line;
    if (!line.toLowerCase().includes(target)) return line;
    if (line.includes("DEPRECATED")) return line;
    changed += 1;
    return `${line} [DEPRECATED ${date}]`;
  });
  if (changed > 0) {
    await fs.writeFile(filePath, `${updated.join("\n").trimEnd()}\n`, "utf8");
  }
  return changed;
}

function normalizePreferenceKey(text: string): string {
  const cleaned = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.split(" ").slice(0, 6).join(" ");
}

function isPreferenceDriftMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(b) || b.startsWith(a);
}

function parsePreferenceLine(line: string): {
  id: string;
  status: "active" | "deprecated";
  text: string;
} | null {
  const match = line.match(
    /^-\s+\d{4}-\d{2}-\d{2}\s+(PREF-\d{8}-\d+)\s+\[([^\]]+)\]:\s*(.+)$/i,
  );
  if (!match) return null;
  const id = match[1];
  const statusRaw = match[2] ?? "";
  const rest = match[3] ?? "";
  const isDeprecated = rest.includes("DEPRECATED") || statusRaw.toLowerCase().includes("deprecated");
  const text = rest.replace(/\s*\[DEPRECATED.*\]$/i, "").trim();
  return {
    id,
    status: isDeprecated ? "deprecated" : "active",
    text,
  };
}

async function deprecateInFile(params: {
  filePath: string;
  template: string;
  date: string;
  text: string;
  idRegex: RegExp;
}): Promise<{ changed: boolean; message?: string }> {
  const content = await readOrInit(params.filePath, params.template);
  const lines = content.split(/\r?\n/);
  const needle = params.text.toLowerCase();
  const isIdLookup = params.idRegex.test(params.text);
  let changed = false;
  const updatedLines = lines.map((line) => {
    if (!line.trim().startsWith("-")) return line;
    const matches = isIdLookup ? line.includes(params.text) : line.toLowerCase().includes(needle);
    if (matches) {
      if (line.includes("DEPRECATED")) return line;
      changed = true;
      return `${line} [DEPRECATED ${params.date}]`;
    }
    return line;
  });
  if (!changed) return { changed: false };
  await fs.writeFile(params.filePath, `${updatedLines.join("\n").trimEnd()}\n`, "utf8");
  return { changed: true, message: "🧠 Marked entry as deprecated." };
}

function nextId(content: string, prefix: string): string {
  const count = content.split(/\r?\n/).filter((line) => line.includes(prefix)).length + 1;
  return `${prefix}${count}`;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
