import type { SurprisebotConfig } from "../config/config.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./defaults.js";
import { coerceToFailoverError, describeFailoverError, isFailoverError } from "./failover-error.js";
import {
  buildModelAliasIndex,
  isCliProvider,
  modelKey,
  parseModelRef,
  resolveConfiguredModelRef,
  resolveModelRefFromString,
} from "./model-selection.js";
import type { FailoverReason } from "./pi-embedded-helpers.js";

type ModelCandidate = {
  provider: string;
  model: string;
};

type FallbackAttempt = {
  provider: string;
  model: string;
  error: string;
  reason?: FailoverReason;
  status?: number;
  code?: string;
};

type CliCooldownEntry = {
  until: number;
  reason?: FailoverReason;
  lastError?: string;
  lastAt: number;
};

const CLI_COOLDOWNS = new Map<string, CliCooldownEntry>();
const CLI_COOLDOWN_MIN_MS = 60 * 1000;
const CLI_COOLDOWN_RATE_LIMIT_MS = 15 * 60 * 1000;
const CLI_COOLDOWN_BILLING_MS = 6 * 60 * 60 * 1000;
const CLI_COOLDOWN_TIMEOUT_MS = 2 * 60 * 1000;
const CLI_COOLDOWN_MAX_MS = 24 * 60 * 60 * 1000;

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  if (name === "AbortError") return true;
  const message =
    "message" in err && typeof err.message === "string" ? err.message.toLowerCase() : "";
  return message.includes("aborted");
}

function parseCooldownMsFromError(message: string): number | null {
  if (!message) return null;
  const retryDelayJson = message.match(/retryDelay\"?:\s*\"?(\d+)s/i);
  if (retryDelayJson) {
    const seconds = Number(retryDelayJson[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }
  const retryAfter = message.match(/retry\s+after\s+(\d+)(?:\s*s|\s*seconds)?/i);
  if (retryAfter) {
    const seconds = Number(retryAfter[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }
  const retryIn = message.match(/retry\s+in\s+(\d+)(?:\s*s|\s*seconds)?/i);
  if (retryIn) {
    const seconds = Number(retryIn[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }
  const resetsIn = message.match(/resets_in_seconds\"?:\s*(\d+)/i);
  if (resetsIn) {
    const seconds = Number(resetsIn[1]);
    if (Number.isFinite(seconds) && seconds > 0) {
      return seconds * 1000;
    }
  }
  const resetsAt = message.match(/resets_at\"?:\s*(\d+)/i);
  if (resetsAt) {
    const epoch = Number(resetsAt[1]);
    if (Number.isFinite(epoch) && epoch > 0) {
      const ms = epoch * 1000 - Date.now();
      if (ms > 0) return ms;
    }
  }
  return null;
}

function resolveCliCooldownMs(reason: FailoverReason | undefined, message: string): number | null {
  if (!reason) return null;
  if (reason === "rate_limit") {
    return parseCooldownMsFromError(message) ?? CLI_COOLDOWN_RATE_LIMIT_MS;
  }
  if (reason === "billing") return CLI_COOLDOWN_BILLING_MS;
  if (reason === "timeout") return CLI_COOLDOWN_TIMEOUT_MS;
  return null;
}

function clampCooldownMs(value: number): number {
  const bounded = Math.max(CLI_COOLDOWN_MIN_MS, value);
  return Math.min(CLI_COOLDOWN_MAX_MS, bounded);
}

function markCliCooldown(params: {
  provider: string;
  model: string;
  reason?: FailoverReason;
  message: string;
}): void {
  const cooldownMs = resolveCliCooldownMs(params.reason, params.message);
  if (!cooldownMs) return;
  const until = Date.now() + clampCooldownMs(cooldownMs);
  const key = modelKey(params.provider, params.model);
  CLI_COOLDOWNS.set(key, {
    until,
    reason: params.reason,
    lastError: params.message,
    lastAt: Date.now(),
  });
}

function isCliInCooldown(provider: string, model: string): boolean {
  const key = modelKey(provider, model);
  const entry = CLI_COOLDOWNS.get(key);
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    CLI_COOLDOWNS.delete(key);
    return false;
  }
  return true;
}

function applyCliCooldownFilter(params: {
  cfg: SurprisebotConfig | undefined;
  candidates: ModelCandidate[];
}): ModelCandidate[] {
  const filtered = params.candidates.filter((candidate) => {
    if (!isCliProvider(candidate.provider, params.cfg)) return true;
    return !isCliInCooldown(candidate.provider, candidate.model);
  });
  return filtered.length > 0 ? filtered : params.candidates;
}

export function __resetCliCooldownsForTest() {
  CLI_COOLDOWNS.clear();
}

function buildAllowedModelKeys(
  cfg: SurprisebotConfig | undefined,
  defaultProvider: string,
): Set<string> | null {
  const rawAllowlist = (() => {
    const modelMap = cfg?.agents?.defaults?.models ?? {};
    return Object.keys(modelMap);
  })();
  if (rawAllowlist.length === 0) return null;
  const keys = new Set<string>();
  for (const raw of rawAllowlist) {
    const parsed = parseModelRef(String(raw ?? ""), defaultProvider);
    if (!parsed) continue;
    keys.add(modelKey(parsed.provider, parsed.model));
  }
  return keys.size > 0 ? keys : null;
}

function resolveImageFallbackCandidates(params: {
  cfg: SurprisebotConfig | undefined;
  defaultProvider: string;
  modelOverride?: string;
}): ModelCandidate[] {
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg ?? {},
    defaultProvider: params.defaultProvider,
  });
  const allowlist = buildAllowedModelKeys(params.cfg, params.defaultProvider);
  const seen = new Set<string>();
  const candidates: ModelCandidate[] = [];

  const addCandidate = (candidate: ModelCandidate, enforceAllowlist: boolean) => {
    if (!candidate.provider || !candidate.model) return;
    const key = modelKey(candidate.provider, candidate.model);
    if (seen.has(key)) return;
    if (enforceAllowlist && allowlist && !allowlist.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  const addRaw = (raw: string, enforceAllowlist: boolean) => {
    const resolved = resolveModelRefFromString({
      raw: String(raw ?? ""),
      defaultProvider: params.defaultProvider,
      aliasIndex,
    });
    if (!resolved) return;
    addCandidate(resolved.ref, enforceAllowlist);
  };

  if (params.modelOverride?.trim()) {
    addRaw(params.modelOverride, false);
  } else {
    const imageModel = params.cfg?.agents?.defaults?.imageModel as
      | { primary?: string }
      | string
      | undefined;
    const primary = typeof imageModel === "string" ? imageModel.trim() : imageModel?.primary;
    if (primary?.trim()) addRaw(primary, false);
  }

  const imageFallbacks = (() => {
    const imageModel = params.cfg?.agents?.defaults?.imageModel as
      | { fallbacks?: string[] }
      | string
      | undefined;
    if (imageModel && typeof imageModel === "object") {
      return imageModel.fallbacks ?? [];
    }
    return [];
  })();

  for (const raw of imageFallbacks) {
    addRaw(raw, true);
  }

  return candidates;
}

function resolveFallbackCandidates(params: {
  cfg: SurprisebotConfig | undefined;
  provider: string;
  model: string;
  /** Optional explicit fallbacks list; when provided (even empty), replaces agents.defaults.model.fallbacks. */
  fallbacksOverride?: string[];
}): ModelCandidate[] {
  const provider = params.provider.trim() || DEFAULT_PROVIDER;
  const model = params.model.trim() || DEFAULT_MODEL;
  const primary = params.cfg
    ? resolveConfiguredModelRef({
        cfg: params.cfg,
        defaultProvider: DEFAULT_PROVIDER,
        defaultModel: DEFAULT_MODEL,
      })
    : null;
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg ?? {},
    defaultProvider: DEFAULT_PROVIDER,
  });
  const allowlist = buildAllowedModelKeys(params.cfg, DEFAULT_PROVIDER);
  const seen = new Set<string>();
  const candidates: ModelCandidate[] = [];

  const addCandidate = (candidate: ModelCandidate, enforceAllowlist: boolean) => {
    if (!candidate.provider || !candidate.model) return;
    const key = modelKey(candidate.provider, candidate.model);
    if (seen.has(key)) return;
    if (enforceAllowlist && allowlist && !allowlist.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  addCandidate({ provider, model }, false);

  const modelFallbacks = (() => {
    if (params.fallbacksOverride !== undefined) return params.fallbacksOverride;
    const model = params.cfg?.agents?.defaults?.model as
      | { fallbacks?: string[] }
      | string
      | undefined;
    if (model && typeof model === "object") return model.fallbacks ?? [];
    return [];
  })();

  for (const raw of modelFallbacks) {
    const resolved = resolveModelRefFromString({
      raw: String(raw ?? ""),
      defaultProvider: DEFAULT_PROVIDER,
      aliasIndex,
    });
    if (!resolved) continue;
    addCandidate(resolved.ref, true);
  }

  if (params.fallbacksOverride === undefined && primary?.provider && primary.model) {
    addCandidate({ provider: primary.provider, model: primary.model }, false);
  }

  return candidates;
}

export async function runWithModelFallback<T>(params: {
  cfg: SurprisebotConfig | undefined;
  provider: string;
  model: string;
  /** Optional explicit fallbacks list; when provided (even empty), replaces agents.defaults.model.fallbacks. */
  fallbacksOverride?: string[];
  run: (provider: string, model: string) => Promise<T>;
  onError?: (attempt: {
    provider: string;
    model: string;
    error: unknown;
    attempt: number;
    total: number;
  }) => void | Promise<void>;
}): Promise<{
  result: T;
  provider: string;
  model: string;
  attempts: FallbackAttempt[];
}> {
  const candidatesRaw = resolveFallbackCandidates({
    cfg: params.cfg,
    provider: params.provider,
    model: params.model,
    fallbacksOverride: params.fallbacksOverride,
  });
  const candidates = applyCliCooldownFilter({
    cfg: params.cfg,
    candidates: candidatesRaw,
  });
  const attempts: FallbackAttempt[] = [];
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i] as ModelCandidate;
    try {
      const result = await params.run(candidate.provider, candidate.model);
      return {
        result,
        provider: candidate.provider,
        model: candidate.model,
        attempts,
      };
    } catch (err) {
      if (isAbortError(err)) throw err;
      const normalized =
        coerceToFailoverError(err, {
          provider: candidate.provider,
          model: candidate.model,
        }) ?? err;
      if (!isFailoverError(normalized)) throw err;

      lastError = normalized;
      const described = describeFailoverError(normalized);
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: described.message,
        reason: described.reason,
        status: described.status,
        code: described.code,
      });
      if (isCliProvider(candidate.provider, params.cfg)) {
        markCliCooldown({
          provider: candidate.provider,
          model: candidate.model,
          reason: described.reason,
          message: described.message,
        });
      }
      await params.onError?.({
        provider: candidate.provider,
        model: candidate.model,
        error: normalized,
        attempt: i + 1,
        total: candidates.length,
      });
    }
  }

  if (attempts.length <= 1 && lastError) throw lastError;
  const summary =
    attempts.length > 0
      ? attempts
          .map(
            (attempt) =>
              `${attempt.provider}/${attempt.model}: ${attempt.error}${
                attempt.reason ? ` (${attempt.reason})` : ""
              }`,
          )
          .join(" | ")
      : "unknown";
  throw new Error(`All models failed (${attempts.length || candidates.length}): ${summary}`, {
    cause: lastError instanceof Error ? lastError : undefined,
  });
}

export async function runWithImageModelFallback<T>(params: {
  cfg: SurprisebotConfig | undefined;
  modelOverride?: string;
  run: (provider: string, model: string) => Promise<T>;
  onError?: (attempt: {
    provider: string;
    model: string;
    error: unknown;
    attempt: number;
    total: number;
  }) => void | Promise<void>;
}): Promise<{
  result: T;
  provider: string;
  model: string;
  attempts: FallbackAttempt[];
}> {
  const candidates = resolveImageFallbackCandidates({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
    modelOverride: params.modelOverride,
  });
  if (candidates.length === 0) {
    throw new Error(
      "No image model configured. Set agents.defaults.imageModel.primary or agents.defaults.imageModel.fallbacks.",
    );
  }

  const attempts: FallbackAttempt[] = [];
  let lastError: unknown;

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i] as ModelCandidate;
    try {
      const result = await params.run(candidate.provider, candidate.model);
      return {
        result,
        provider: candidate.provider,
        model: candidate.model,
        attempts,
      };
    } catch (err) {
      if (isAbortError(err)) throw err;
      lastError = err;
      attempts.push({
        provider: candidate.provider,
        model: candidate.model,
        error: err instanceof Error ? err.message : String(err),
      });
      await params.onError?.({
        provider: candidate.provider,
        model: candidate.model,
        error: err,
        attempt: i + 1,
        total: candidates.length,
      });
    }
  }

  if (attempts.length <= 1 && lastError) throw lastError;
  const summary =
    attempts.length > 0
      ? attempts
          .map((attempt) => `${attempt.provider}/${attempt.model}: ${attempt.error}`)
          .join(" | ")
      : "unknown";
  throw new Error(`All image models failed (${attempts.length || candidates.length}): ${summary}`, {
    cause: lastError instanceof Error ? lastError : undefined,
  });
}
