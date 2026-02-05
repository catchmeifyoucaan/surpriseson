import { Type } from "@sinclair/typebox";

import type { SurprisebotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { getMemorySearchManager } from "../../memory/index.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { resolveMemorySearchConfig } from "../memory-search.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const MemorySearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Number()),
  minScore: Type.Optional(Type.Number()),
});

const MemoryGetSchema = Type.Object({
  path: Type.String(),
  from: Type.Optional(Type.Number()),
  lines: Type.Optional(Type.Number()),
});

export function createMemorySearchTool(options: {
  config?: SurprisebotConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = (() => {
    if (options.config) return options.config;
    try {
      return loadConfig();
    } catch {
      return null;
    }
  })();
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg ?? undefined,
  });
  if (!cfg || !resolveMemorySearchConfig(cfg, agentId)) {
    return {
      label: "Memory Search",
      name: "memory_search",
      description:
        "Memory search is unavailable in this context (disabled or config missing).",
      parameters: MemorySearchSchema,
      execute: async (_toolCallId) => {
        return jsonResult({
          results: [],
          disabled: true,
          error: cfg ? "memory search disabled" : "memory search config unavailable",
        });
      },
    };
  }
  return {
    label: "Memory Search",
    name: "memory_search",
    description:
      "Mandatory recall step: semantically search MEMORY.md + memory/*.md before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines.",
    parameters: MemorySearchSchema,
    execute: async (_toolCallId, params) => {
      const query = readStringParam(params, "query", { required: true });
      const maxResults = readNumberParam(params, "maxResults");
      const minScore = readNumberParam(params, "minScore");
      const { manager, error } = await getMemorySearchManager({
        cfg,
        agentId,
      });
      if (!manager) {
        return jsonResult({ results: [], disabled: true, error });
      }
      const results = await manager.search(query, {
        maxResults,
        minScore,
        sessionKey: options.agentSessionKey,
      });
      const status = manager.status();
      return jsonResult({
        results,
        provider: status.provider,
        model: status.model,
        fallback: status.fallback,
      });
    },
  };
}

export function createMemoryGetTool(options: {
  config?: SurprisebotConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = (() => {
    if (options.config) return options.config;
    try {
      return loadConfig();
    } catch {
      return null;
    }
  })();
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg ?? undefined,
  });
  if (!cfg || !resolveMemorySearchConfig(cfg, agentId)) {
    return {
      label: "Memory Get",
      name: "memory_get",
      description: "Memory get is unavailable in this context (disabled or config missing).",
      parameters: MemoryGetSchema,
      execute: async (_toolCallId, params) => {
        const relPath = readStringParam(params, "path", { required: true });
        return jsonResult({
          path: relPath,
          text: "",
          disabled: true,
          error: cfg ? "memory search disabled" : "memory search config unavailable",
        });
      },
    };
  }
  return {
    label: "Memory Get",
    name: "memory_get",
    description:
      "Safe snippet read from MEMORY.md or memory/*.md with optional from/lines; use after memory_search to pull only the needed lines and keep context small.",
    parameters: MemoryGetSchema,
    execute: async (_toolCallId, params) => {
      const relPath = readStringParam(params, "path", { required: true });
      const from = readNumberParam(params, "from", { integer: true });
      const lines = readNumberParam(params, "lines", { integer: true });
      const { manager, error } = await getMemorySearchManager({
        cfg,
        agentId,
      });
      if (!manager) {
        return jsonResult({ path: relPath, text: "", disabled: true, error });
      }
      const result = await manager.readFile({
        relPath,
        from: from ?? undefined,
        lines: lines ?? undefined,
      });
      return jsonResult(result);
    },
  };
}
