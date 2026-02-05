import type { SurprisebotConfig } from "../../config/config.js";
import { resolveAgentConfig } from "../../agents/agent-scope.js";
import { SILENT_REPLY_TOKEN } from "../tokens.js";

export const DEFAULT_MEMORY_CAPTURE_MIN_INTERVAL_MINUTES = 20;
export const DEFAULT_MEMORY_CAPTURE_MIN_NEW_TOKENS = 800;

export const DEFAULT_MEMORY_CAPTURE_PROMPT = [
  "Post-turn memory capture.",
  "Update durable memory files with only high-signal changes:",
  "- memory/profile.md (stable identity, preferences, constraints, environment)",
  "- memory/preferences.md (preference history + drift notes)",
  "- memory/decisions.md (decisions + rationale + date)",
  "- memory/active.md (current goals, open tasks, next steps)",
  "- memory/shared.md (shared across agents; only update when explicitly instructed)",
  "- memory/shared.pending.md (proposals only; write only when explicitly instructed)",
  "- memory/YYYY-MM-DD.md (append brief episodic log for today)",
  "Mark deprecated decisions/preferences inline when superseded.",
  "When deprecating, add 'superseded by <ID>' if the successor is known.",
  "Use concise bullets, one idea per line. Never include secrets or API keys.",
  `If nothing to store, reply with ${SILENT_REPLY_TOKEN}.`,
].join(" ");

export const DEFAULT_MEMORY_CAPTURE_SYSTEM_PROMPT = [
  "Memory capture turn.",
  "Write to memory files using file tools; keep changes minimal and durable.",
  `If no user-visible reply is needed, start with ${SILENT_REPLY_TOKEN}.`,
].join(" ");

export type MemoryCaptureSettings = {
  enabled: boolean;
  minIntervalMinutes: number;
  minNewTokens: number;
  prompt: string;
  systemPrompt: string;
};

const normalizeNonNegativeInt = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const int = Math.floor(value);
  return int >= 0 ? int : null;
};

export function resolveMemoryCaptureSettings(params: {
  cfg: SurprisebotConfig;
  agentId?: string;
}): MemoryCaptureSettings | null {
  const defaults = params.cfg.agents?.defaults?.memoryCapture;
  const overrides = params.agentId
    ? resolveAgentConfig(params.cfg, params.agentId)?.memoryCapture
    : undefined;
  const enabled = overrides?.enabled ?? defaults?.enabled ?? false;
  if (!enabled) return null;
  const minIntervalMinutes =
    normalizeNonNegativeInt(overrides?.minIntervalMinutes) ??
    normalizeNonNegativeInt(defaults?.minIntervalMinutes) ??
    DEFAULT_MEMORY_CAPTURE_MIN_INTERVAL_MINUTES;
  const minNewTokens =
    normalizeNonNegativeInt(overrides?.minNewTokens) ??
    normalizeNonNegativeInt(defaults?.minNewTokens) ??
    DEFAULT_MEMORY_CAPTURE_MIN_NEW_TOKENS;
  const prompt = overrides?.prompt?.trim() || defaults?.prompt?.trim() || DEFAULT_MEMORY_CAPTURE_PROMPT;
  const systemPrompt =
    overrides?.systemPrompt?.trim() ||
    defaults?.systemPrompt?.trim() ||
    DEFAULT_MEMORY_CAPTURE_SYSTEM_PROMPT;

  return {
    enabled,
    minIntervalMinutes,
    minNewTokens,
    prompt: ensureNoReplyHint(prompt),
    systemPrompt: ensureNoReplyHint(systemPrompt),
  };
}

function ensureNoReplyHint(text: string): string {
  if (text.includes(SILENT_REPLY_TOKEN)) return text;
  return `${text}\n\nIf no user-visible reply is needed, start with ${SILENT_REPLY_TOKEN}.`;
}

export function shouldRunMemoryCapture(params: {
  entry?: { totalTokens?: number; memoryCaptureAt?: number; memoryCaptureTokenCount?: number };
  now: number;
  minIntervalMinutes: number;
  minNewTokens: number;
}): boolean {
  const lastAt = params.entry?.memoryCaptureAt;
  if (typeof lastAt === "number") {
    const elapsedMs = params.now - lastAt;
    const minMs = Math.max(0, Math.floor(params.minIntervalMinutes)) * 60_000;
    if (minMs > 0 && elapsedMs < minMs) return false;
  }
  const totalTokens = params.entry?.totalTokens;
  const lastTokens = params.entry?.memoryCaptureTokenCount;
  if (typeof totalTokens === "number" && typeof lastTokens === "number") {
    const delta = totalTokens - lastTokens;
    if (delta < Math.max(0, Math.floor(params.minNewTokens))) return false;
  }
  return true;
}
