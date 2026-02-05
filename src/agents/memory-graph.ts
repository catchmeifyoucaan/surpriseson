import type { SurprisebotConfig, MemoryGraphConfig } from "../config/config.js";
import { resolveAgentConfig } from "./agent-scope.js";

export type ResolvedMemoryGraphConfig = {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  database?: string;
  sync: {
    onSessionStart: boolean;
    onSearch: boolean;
    watch: boolean;
    watchDebounceMs: number;
    intervalMinutes: number;
  };
  query: {
    maxResults: number;
    maxHops: number;
  };
};

const DEFAULT_URL = "bolt://127.0.0.1:7687";
const DEFAULT_WATCH_DEBOUNCE_MS = 1500;
const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_MAX_HOPS = 1;

function mergeConfig(
  defaults: MemoryGraphConfig | undefined,
  overrides: MemoryGraphConfig | undefined,
): ResolvedMemoryGraphConfig | null {
  const enabled = overrides?.enabled ?? defaults?.enabled ?? false;
  if (!enabled) return null;
  const url = overrides?.url ?? defaults?.url ?? DEFAULT_URL;
  const username = overrides?.username ?? defaults?.username ?? "";
  const password = overrides?.password ?? defaults?.password ?? "";
  if (!url || !username || !password) return null;

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
    maxHops: overrides?.query?.maxHops ?? defaults?.query?.maxHops ?? DEFAULT_MAX_HOPS,
  };

  return {
    enabled,
    url,
    username,
    password,
    database: overrides?.database ?? defaults?.database,
    sync,
    query: {
      maxResults: Math.max(1, Math.floor(query.maxResults)),
      maxHops: Math.max(1, Math.floor(query.maxHops)),
    },
  };
}

export function resolveMemoryGraphConfig(
  cfg: SurprisebotConfig,
  agentId: string,
): ResolvedMemoryGraphConfig | null {
  const defaults = cfg.agents?.defaults?.memoryGraph;
  const overrides = resolveAgentConfig(cfg, agentId)?.memoryGraph;
  return mergeConfig(defaults, overrides);
}
