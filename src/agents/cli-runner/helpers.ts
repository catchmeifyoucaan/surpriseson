import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ImageContent } from "@mariozechner/pi-ai";
import type { ThinkLevel } from "../../auto-reply/thinking.js";
import type { SurprisebotConfig } from "../../config/config.js";
import type { CliBackendConfig } from "../../config/types.js";
import { runExec } from "../../process/exec.js";
import type { EmbeddedContextFile } from "../pi-embedded-helpers.js";
import { buildAgentSystemPrompt } from "../system-prompt.js";

const CLI_RUN_QUEUE = new Map<string, Promise<unknown>>();

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function cleanupResumeProcesses(
  backend: CliBackendConfig,
  sessionId: string,
): Promise<void> {
  if (process.platform === "win32") return;
  const resumeArgs = backend.resumeArgs ?? [];
  if (resumeArgs.length === 0) return;
  if (!resumeArgs.some((arg) => arg.includes("{sessionId}"))) return;
  const commandToken = path.basename(backend.command ?? "").trim();
  if (!commandToken) return;

  const resumeTokens = resumeArgs.map((arg) => arg.replaceAll("{sessionId}", sessionId));
  const pattern = [commandToken, ...resumeTokens]
    .filter(Boolean)
    .map((token) => escapeRegex(token))
    .join(".*");
  if (!pattern) return;

  try {
    await runExec("pkill", ["-f", pattern]);
  } catch {
    // ignore missing pkill or no matches
  }
}

export function enqueueCliRun<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prior = CLI_RUN_QUEUE.get(key) ?? Promise.resolve();
  const chained = prior.catch(() => undefined).then(task);
  const tracked = chained.finally(() => {
    if (CLI_RUN_QUEUE.get(key) === tracked) {
      CLI_RUN_QUEUE.delete(key);
    }
  });
  CLI_RUN_QUEUE.set(key, tracked);
  return tracked;
}

type CliUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
};

type CliToolResults = {
  started: number;
  ended: number;
  pending: Array<{
    id: string;
    name: string;
    meta?: string;
    startedAt?: number;
    timedOut?: boolean;
  }>;
  timedOut: Array<{
    id: string;
    name: string;
    meta?: string;
    startedAt?: number;
  }>;
};

export type CliOutput = {
  text: string;
  sessionId?: string;
  usage?: CliUsage;
  toolResults?: CliToolResults;
};

function resolveUserTimezone(configured?: string): string {
  const trimmed = configured?.trim();
  if (trimmed) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
      return trimmed;
    } catch {
      // ignore invalid timezone
    }
  }
  const host = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return host?.trim() || "UTC";
}

function formatUserTime(date: Date, timeZone: string): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      weekday: "long",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const map: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") map[part.type] = part.value;
    }
    if (!map.weekday || !map.year || !map.month || !map.day || !map.hour || !map.minute)
      return undefined;
    return `${map.weekday} ${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}`;
  } catch {
    return undefined;
  }
}

function buildModelAliasLines(cfg?: SurprisebotConfig) {
  const models = cfg?.agents?.defaults?.models ?? {};
  const entries: Array<{ alias: string; model: string }> = [];
  for (const [keyRaw, entryRaw] of Object.entries(models)) {
    const model = String(keyRaw ?? "").trim();
    if (!model) continue;
    const alias = String((entryRaw as { alias?: string } | undefined)?.alias ?? "").trim();
    if (!alias) continue;
    entries.push({ alias, model });
  }
  return entries
    .sort((a, b) => a.alias.localeCompare(b.alias))
    .map((entry) => `- ${entry.alias}: ${entry.model}`);
}

export function buildSystemPrompt(params: {
  workspaceDir: string;
  config?: SurprisebotConfig;
  defaultThinkLevel?: ThinkLevel;
  extraSystemPrompt?: string;
  ownerNumbers?: string[];
  heartbeatPrompt?: string;
  tools: AgentTool[];
  contextFiles?: EmbeddedContextFile[];
  modelDisplay: string;
}) {
  const userTimezone = resolveUserTimezone(params.config?.agents?.defaults?.userTimezone);
  const userTime = formatUserTime(new Date(), userTimezone);
  return buildAgentSystemPrompt({
    workspaceDir: params.workspaceDir,
    defaultThinkLevel: params.defaultThinkLevel,
    extraSystemPrompt: params.extraSystemPrompt,
    ownerNumbers: params.ownerNumbers,
    reasoningTagHint: false,
    heartbeatPrompt: params.heartbeatPrompt,
    runtimeInfo: {
      host: "surprisebot",
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      node: process.version,
      model: params.modelDisplay,
    },
    toolNames: params.tools.map((tool) => tool.name),
    modelAliasLines: buildModelAliasLines(params.config),
    userTimezone,
    userTime,
    contextFiles: params.contextFiles,
  });
}

export function normalizeCliModel(modelId: string, backend: CliBackendConfig): string {
  const trimmed = modelId.trim();
  if (!trimmed) return trimmed;
  const direct = backend.modelAliases?.[trimmed];
  if (direct) return direct;
  const lower = trimmed.toLowerCase();
  const mapped = backend.modelAliases?.[lower];
  if (mapped) return mapped;
  return trimmed;
}

function toUsage(raw: Record<string, unknown>): CliUsage | undefined {
  const pick = (key: string) =>
    typeof raw[key] === "number" && raw[key] > 0 ? (raw[key] as number) : undefined;
  const input = pick("input_tokens") ?? pick("inputTokens");
  const output = pick("output_tokens") ?? pick("outputTokens");
  const cacheRead =
    pick("cache_read_input_tokens") ?? pick("cached_input_tokens") ?? pick("cacheRead");
  const cacheWrite = pick("cache_write_input_tokens") ?? pick("cacheWrite");
  const total = pick("total_tokens") ?? pick("total");
  if (!input && !output && !cacheRead && !cacheWrite && !total) return undefined;
  return { input, output, cacheRead, cacheWrite, total };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function collectText(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((entry) => collectText(entry)).join("");
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string") return value.content;
  if (Array.isArray(value.content))
    return value.content.map((entry) => collectText(entry)).join("");
  if (isRecord(value.message)) return collectText(value.message);
  return "";
}

function coerceString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function truncateMeta(value: string, limit = 500): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit)}...`;
}

function coerceMeta(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? truncateMeta(trimmed) : undefined;
  }
  if (Array.isArray(value) || isRecord(value)) {
    try {
      const raw = JSON.stringify(value);
      if (!raw) return undefined;
      return truncateMeta(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function toToolName(item: Record<string, unknown>, itemType?: string): string | undefined {
  const normalizedType = itemType?.toLowerCase() ?? "";
  if (normalizedType.includes("command_execution") || normalizedType.includes("command")) return "exec";
  const direct =
    coerceString(item.tool_name) ||
    coerceString(item.tool) ||
    (isRecord(item.tool) ? coerceString(item.tool.name) : undefined) ||
    coerceString(item.name) ||
    coerceString(item.action) ||
    (isRecord(item.action) ? coerceString(item.action.name) : undefined) ||
    (isRecord(item.function) ? coerceString(item.function.name) : undefined);
  if (direct) return direct;
  if (normalizedType &&
      normalizedType !== "agent_message" &&
      normalizedType !== "assistant_message" &&
      normalizedType !== "message" &&
      normalizedType !== "reasoning" &&
      normalizedType !== "thinking" &&
      normalizedType !== "analysis") {
    return normalizedType;
  }
  return undefined;
}

function isToolItem(item: Record<string, unknown>, itemType?: string): boolean {
  const normalizedType = itemType?.toLowerCase() ?? "";
  if (
    normalizedType === "agent_message" ||
    normalizedType === "assistant_message" ||
    normalizedType === "message" ||
    normalizedType === "reasoning" ||
    normalizedType === "thinking" ||
    normalizedType === "analysis"
  ) {
    return false;
  }
  if (normalizedType.includes("command_execution")) return true;
  if (normalizedType.includes("tool")) return true;
  if (normalizedType.includes("function")) return true;
  if (normalizedType.includes("action")) return true;
  if (typeof item.command === "string" && item.command.trim()) return true;
  if (item.tool || item.tool_name || item.function || item.arguments || item.args || item.parameters) return true;
  return false;
}

type ToolEventEntry = {
  id: string;
  name: string;
  meta?: string;
  startedAt?: number;
  ended?: boolean;
  timedOut?: boolean;
};

function collectToolResultsFromRecords(records: Record<string, unknown>[]): CliToolResults | undefined {
  const toolEvents = new Map<string, ToolEventEntry>();
  let counter = 0;

  const recordToolEvent = (item: Record<string, unknown>, eventTypeOverride?: string) => {
    const itemType = coerceString(item.type);
    if (!isToolItem(item, itemType)) return;
    const toolName = toToolName(item, itemType) ?? "tool";
    const command = coerceString(item.command);
    const id =
      coerceString(item.id) ||
      coerceString(item.tool_call_id) ||
      coerceString(item.call_id) ||
      coerceString(item.invocation_id) ||
      coerceString(item.tool_result_id) ||
      coerceString(item.result_id) ||
      coerceString(item.request_id) ||
      (command ? `cmd:${command}` : undefined) ||
      (toolName ? `tool:${toolName}:${++counter}` : `tool:${++counter}`);

    const existing = toolEvents.get(id) ?? { id, name: toolName };
    if (!existing.meta) {
      const meta =
        command ||
        coerceMeta(item.arguments) ||
        coerceMeta(item.args) ||
        coerceMeta(item.parameters) ||
        coerceMeta(item.input) ||
        coerceMeta(item.payload);
      if (meta) existing.meta = meta;
    }

    const eventType = (eventTypeOverride ?? coerceString((item as { _eventType?: unknown })._eventType))
      ? (eventTypeOverride ?? coerceString((item as { _eventType?: unknown })._eventType))!.toLowerCase()
      : "";
    const status = (coerceString(item.status) ?? "").toLowerCase();
    const hasOutput =
      typeof item.aggregated_output === "string" ||
      typeof item.output === "string" ||
      typeof item.result === "string" ||
      typeof item.exit_code === "number";
    const started =
      eventType.includes("started") ||
      status === "in_progress" ||
      status === "running" ||
      status === "started" ||
      status === "queued";
    const timedOut =
      eventType.includes("timeout") || status === "timed_out" || status === "timeout";
    const ended =
      timedOut ||
      eventType.includes("completed") ||
      eventType.includes("finished") ||
      eventType.includes("done") ||
      eventType.includes("failed") ||
      eventType.includes("error") ||
      status === "completed" ||
      status === "succeeded" ||
      status === "success" ||
      status === "done" ||
      status === "failed" ||
      status === "error" ||
      status === "canceled" ||
      status === "cancelled" ||
      hasOutput;

    if (started || ended || timedOut || hasOutput) {
      existing.startedAt = existing.startedAt ?? Date.now();
    }
    if (ended) existing.ended = true;
    if (timedOut) existing.timedOut = true;

    toolEvents.set(id, existing);
  };

  const handleToolList = (list: unknown, eventTypeOverride?: string) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (!isRecord(entry)) continue;
      recordToolEvent(entry, eventTypeOverride);
    }
  };

  for (const record of records) {
    const eventType = coerceString(record.type)?.toLowerCase() ?? "";
    const item = isRecord(record.item) ? record.item : null;
    if (item) {
      (item as { _eventType?: string })._eventType = eventType;
      recordToolEvent(item);
    }

    const handleItemList = (list: unknown) => {
      if (!Array.isArray(list)) return;
      for (const entry of list) {
        if (!isRecord(entry)) continue;
        (entry as { _eventType?: string })._eventType = eventType;
        recordToolEvent(entry);
      }
    };

    handleToolList(record.tool_calls ?? record.toolCalls ?? record.tool_call ?? record.toolCall, "started");
    handleToolList(record.tool_results ?? record.toolResults ?? record.tool_result ?? record.toolResult, "completed");

    const singleToolResult = record.tool_result ?? record.toolResult;
    if (isRecord(singleToolResult)) {
      recordToolEvent(singleToolResult, "completed");
    }
    const singleToolCall = record.tool_call ?? record.toolCall;
    if (isRecord(singleToolCall)) {
      recordToolEvent(singleToolCall, "started");
    }

    handleItemList(record.content);
    handleItemList(record.items);
    const message = isRecord(record.message) ? record.message : null;
    if (message) {
      handleItemList(message.content);
    }
  }

  if (toolEvents.size === 0) return undefined;
  const pending: CliToolResults["pending"] = [];
  const timedOut: CliToolResults["timedOut"] = [];
  let ended = 0;
  for (const entry of toolEvents.values()) {
    if (entry.timedOut) {
      timedOut.push({
        id: entry.id,
        name: entry.name,
        meta: entry.meta,
        startedAt: entry.startedAt,
      });
      continue;
    }
    if (entry.ended) {
      ended += 1;
    } else {
      pending.push({
        id: entry.id,
        name: entry.name,
        meta: entry.meta,
        startedAt: entry.startedAt,
      });
    }
  }
  return { started: toolEvents.size, ended, pending, timedOut };
}

function pickSessionId(
  parsed: Record<string, unknown>,
  backend: CliBackendConfig,
): string | undefined {
  const fields = backend.sessionIdFields ?? [
    "session_id",
    "sessionId",
    "conversation_id",
    "conversationId",
  ];
  for (const field of fields) {
    const value = parsed[field];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

export function parseCliJson(raw: string, backend: CliBackendConfig): CliOutput | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const sessionId = pickSessionId(parsed, backend);
  const usage = isRecord(parsed.usage) ? toUsage(parsed.usage) : undefined;
  const text =
    collectText(parsed.message) ||
    collectText(parsed.content) ||
    collectText(parsed.result) ||
    collectText(parsed);
  const toolResults = collectToolResultsFromRecords([parsed]);
  const trimmedText = text.trim();
  if (!trimmedText && !toolResults) return null;
  return { text: trimmedText, sessionId, usage, toolResults };
}

export function parseCliJsonl(raw: string, backend: CliBackendConfig): CliOutput | null {
  const lines = raw
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  let sessionId: string | undefined;
  let usage: CliUsage | undefined;
  const texts: string[] = [];
  const records: Record<string, unknown>[] = [];
  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(parsed)) continue;
    records.push(parsed);
    if (!sessionId) sessionId = pickSessionId(parsed, backend);
    if (!sessionId && typeof parsed.thread_id === "string") {
      sessionId = parsed.thread_id.trim();
    }
    if (isRecord(parsed.usage)) {
      usage = toUsage(parsed.usage) ?? usage;
    }
    const item = isRecord(parsed.item) ? parsed.item : null;
    if (item && typeof item.text === "string") {
      const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
      if (!type || type.includes("message")) {
        texts.push(item.text);
      }
    }
  }
  const text = texts.join("\n").trim();
  const toolResults = collectToolResultsFromRecords(records);
  if (!text && !toolResults) return null;
  return { text, sessionId, usage, toolResults };
}

export function resolveSystemPromptUsage(params: {
  backend: CliBackendConfig;
  isNewSession: boolean;
  systemPrompt?: string;
}): string | null {
  const systemPrompt = params.systemPrompt?.trim();
  if (!systemPrompt) return null;
  const when = params.backend.systemPromptWhen ?? "first";
  if (when === "never") return null;
  if (when === "first" && !params.isNewSession) return null;
  if (!params.backend.systemPromptArg?.trim()) return null;
  return systemPrompt;
}

export function resolveSessionIdToSend(params: {
  backend: CliBackendConfig;
  cliSessionId?: string;
}): { sessionId?: string; isNew: boolean } {
  const mode = params.backend.sessionMode ?? "always";
  const existing = params.cliSessionId?.trim();
  if (mode === "none") return { sessionId: undefined, isNew: !existing };
  if (mode === "existing") return { sessionId: existing, isNew: !existing };
  if (existing) return { sessionId: existing, isNew: false };
  return { sessionId: crypto.randomUUID(), isNew: true };
}

export function resolvePromptInput(params: { backend: CliBackendConfig; prompt: string }): {
  argsPrompt?: string;
  stdin?: string;
} {
  const inputMode = params.backend.input ?? "arg";
  if (inputMode === "stdin") {
    return { stdin: params.prompt };
  }
  if (params.backend.maxPromptArgChars && params.prompt.length > params.backend.maxPromptArgChars) {
    return { stdin: params.prompt };
  }
  return { argsPrompt: params.prompt };
}

function resolveImageExtension(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("webp")) return "webp";
  return "bin";
}

export function appendImagePathsToPrompt(prompt: string, paths: string[]): string {
  if (!paths.length) return prompt;
  const trimmed = prompt.trimEnd();
  const separator = trimmed ? "\n\n" : "";
  return `${trimmed}${separator}${paths.join("\n")}`;
}

export async function writeCliImages(
  images: ImageContent[],
): Promise<{ paths: string[]; cleanup: () => Promise<void> }> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "surprisebot-cli-images-"));
  const paths: string[] = [];
  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];
    const ext = resolveImageExtension(image.mimeType);
    const filePath = path.join(tempDir, `image-${i + 1}.${ext}`);
    const buffer = Buffer.from(image.data, "base64");
    await fs.writeFile(filePath, buffer, { mode: 0o600 });
    paths.push(filePath);
  }
  const cleanup = async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  };
  return { paths, cleanup };
}

export function buildCliArgs(params: {
  backend: CliBackendConfig;
  baseArgs: string[];
  modelId: string;
  sessionId?: string;
  systemPrompt?: string | null;
  imagePaths?: string[];
  promptArg?: string;
  useResume: boolean;
}): string[] {
  const args: string[] = [...params.baseArgs];
  if (!params.useResume && params.backend.modelArg && params.modelId) {
    args.push(params.backend.modelArg, params.modelId);
  }
  if (!params.useResume && params.systemPrompt && params.backend.systemPromptArg) {
    args.push(params.backend.systemPromptArg, params.systemPrompt);
  }
  if (!params.useResume && params.sessionId) {
    if (params.backend.sessionArgs && params.backend.sessionArgs.length > 0) {
      for (const entry of params.backend.sessionArgs) {
        args.push(entry.replaceAll("{sessionId}", params.sessionId));
      }
    } else if (params.backend.sessionArg) {
      args.push(params.backend.sessionArg, params.sessionId);
    }
  }
  if (params.imagePaths && params.imagePaths.length > 0) {
    const mode = params.backend.imageMode ?? "repeat";
    const imageArg = params.backend.imageArg;
    if (imageArg) {
      if (mode === "list") {
        args.push(imageArg, params.imagePaths.join(","));
      } else {
        for (const imagePath of params.imagePaths) {
          args.push(imageArg, imagePath);
        }
      }
    }
  }
  if (params.promptArg !== undefined) {
    args.push(params.promptArg);
  }
  return args;
}
