import os from "node:os";
import path from "node:path";

import type { SurprisebotConfig, MemorySearchConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { resolveUserPath } from "../utils.js";
import { resolveAgentConfig } from "./agent-scope.js";

export type ResolvedMemorySearchConfig = {
  enabled: boolean;
  provider: "openai" | "local" | "google";
  remote?: {
    baseUrl?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  };
  fallback: "openai" | "google" | "none";
  model: string;
  local: {
    modelPath?: string;
    modelCacheDir?: string;
  };
  store: {
    driver: "sqlite";
    path: string;
  };
  chunking: {
    tokens: number;
    overlap: number;
  };
  sync: {
    onSessionStart: boolean;
    onSearch: boolean;
    watch: boolean;
    watchDebounceMs: number;
    intervalMinutes: number;
  };
  query: {
    maxResults: number;
    minScore: number;
  };
};

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_GOOGLE_MODEL = "gemini-embedding-001";
const DEFAULT_CHUNK_TOKENS = 400;
const DEFAULT_CHUNK_OVERLAP = 80;
const DEFAULT_WATCH_DEBOUNCE_MS = 1500;
const DEFAULT_MAX_RESULTS = 6;
const DEFAULT_MIN_SCORE = 0.35;

function normalizeMemoryProvider(raw?: string): "openai" | "local" | "google" {
  const value = (raw ?? "").trim().toLowerCase();
  if (value == "local") return "local";
  if (value == "google" || value == "gemini") return "google";
  return "openai";
}

function normalizeMemoryFallback(raw?: string): "openai" | "google" | "none" {
  const value = (raw ?? "").trim().toLowerCase();
  if (value == "none") return "none";
  if (value == "google" || value == "gemini") return "google";
  if (value == "openai") return "openai";
  return "openai";
}

function resolveStorePath(agentId: string, raw?: string): string {
  const stateDir = resolveStateDir(process.env, os.homedir);
  const fallback = path.join(stateDir, "memory", `${agentId}.sqlite`);
  if (!raw) return fallback;
  const withToken = raw.includes("{agentId}") ? raw.replaceAll("{agentId}", agentId) : raw;
  return resolveUserPath(withToken);
}

function mergeConfig(
  defaults: MemorySearchConfig | undefined,
  overrides: MemorySearchConfig | undefined,
  agentId: string,
): ResolvedMemorySearchConfig {
  const enabled = overrides?.enabled ?? defaults?.enabled ?? true;
  const provider = normalizeMemoryProvider(overrides?.provider ?? defaults?.provider);
  const hasRemote = Boolean(defaults?.remote || overrides?.remote);
  const remote = hasRemote
    ? {
        baseUrl: overrides?.remote?.baseUrl ?? defaults?.remote?.baseUrl,
        apiKey: overrides?.remote?.apiKey ?? defaults?.remote?.apiKey,
        headers: overrides?.remote?.headers ?? defaults?.remote?.headers,
      }
    : undefined;
  const fallback = normalizeMemoryFallback(overrides?.fallback ?? defaults?.fallback);
  const defaultModel = provider === "google" ? DEFAULT_GOOGLE_MODEL : DEFAULT_MODEL;
  const model = overrides?.model ?? defaults?.model ?? defaultModel;
  const local = {
    modelPath: overrides?.local?.modelPath ?? defaults?.local?.modelPath,
    modelCacheDir: overrides?.local?.modelCacheDir ?? defaults?.local?.modelCacheDir,
  };
  const store = {
    driver: overrides?.store?.driver ?? defaults?.store?.driver ?? "sqlite",
    path: resolveStorePath(agentId, overrides?.store?.path ?? defaults?.store?.path),
  };
  const chunking = {
    tokens: overrides?.chunking?.tokens ?? defaults?.chunking?.tokens ?? DEFAULT_CHUNK_TOKENS,
    overlap: overrides?.chunking?.overlap ?? defaults?.chunking?.overlap ?? DEFAULT_CHUNK_OVERLAP,
  };
  const sync = {
    onSessionStart: overrides?.sync?.onSessionStart ?? defaults?.sync?.onSessionStart ?? true,
    onSearch: overrides?.sync?.onSearch ?? defaults?.sync?.onSearch ?? true,
    watch: overrides?.sync?.watch ?? defaults?.sync?.watch ?? true,
    watchDebounceMs:
      overrides?.sync?.watchDebounceMs ??
      defaults?.sync?.watchDebounceMs ??
      DEFAULT_WATCH_DEBOUNCE_MS,
    intervalMinutes: overrides?.sync?.intervalMinutes ?? defaults?.sync?.intervalMinutes ?? 0,
  };
  const query = {
    maxResults: overrides?.query?.maxResults ?? defaults?.query?.maxResults ?? DEFAULT_MAX_RESULTS,
    minScore: overrides?.query?.minScore ?? defaults?.query?.minScore ?? DEFAULT_MIN_SCORE,
  };

  const overlap = Math.max(0, Math.min(chunking.overlap, chunking.tokens - 1));
  const minScore = Math.max(0, Math.min(1, query.minScore));
  return {
    enabled,
    provider,
    remote,
    fallback,
    model,
    local,
    store,
    chunking: { tokens: Math.max(1, chunking.tokens), overlap },
    sync,
    query: { ...query, minScore },
  };
}

export function resolveMemorySearchConfig(
  cfg: SurprisebotConfig,
  agentId: string,
): ResolvedMemorySearchConfig | null {
  const defaults = cfg.agents?.defaults?.memorySearch;
  const overrides = resolveAgentConfig(cfg, agentId)?.memorySearch;
  const resolved = mergeConfig(defaults, overrides, agentId);
  if (!resolved.enabled) return null;
  return resolved;
}
