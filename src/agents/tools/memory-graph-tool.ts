import { Type } from "@sinclair/typebox";

import type { SurprisebotConfig } from "../../config/config.js";
import {
  getMemoryGraphManager,
  getMemorySearchManager,
  type MemoryGraphQueryResult,
} from "../../memory/index.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { resolveMemoryGraphConfig } from "../memory-graph.js";
import { resolveMemorySearchConfig } from "../memory-search.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const MemoryGraphQuerySchema = Type.Object({
  query: Type.String(),
  types: Type.Optional(Type.Array(Type.String())),
  maxResults: Type.Optional(Type.Number()),
  maxHops: Type.Optional(Type.Number()),
});

const MemoryRagQuerySchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Number()),
  minScore: Type.Optional(Type.Number()),
  graphTypes: Type.Optional(Type.Array(Type.String())),
  graphMaxResults: Type.Optional(Type.Number()),
  graphMaxHops: Type.Optional(Type.Number()),
});

function createDisabledTool(params: {
  label: string;
  name: string;
  description: string;
  schema: typeof MemoryGraphQuerySchema | typeof MemoryRagQuerySchema;
  error: string;
}): AnyAgentTool {
  return {
    label: params.label,
    name: params.name,
    description: params.description,
    parameters: params.schema,
    execute: async (_toolCallId) => {
      return jsonResult({ disabled: true, error: params.error });
    },
  };
}

export function createMemoryGraphQueryTool(options: {
  config?: SurprisebotConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return createDisabledTool({
      label: "Memory Graph Query",
      name: "memory_graph_query",
      description:
        "Memory graph is unavailable in this context (config missing).",
      schema: MemoryGraphQuerySchema,
      error: "memory graph config unavailable",
    });
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemoryGraphConfig(cfg, agentId)) {
    return createDisabledTool({
      label: "Memory Graph Query",
      name: "memory_graph_query",
      description:
        "Memory graph is unavailable in this context (disabled in config).",
      schema: MemoryGraphQuerySchema,
      error: "memory graph disabled",
    });
  }
  return {
    label: "Memory Graph Query",
    name: "memory_graph_query",
    description:
      "Query the memory graph for relationships, drift, and dependencies between memory entries. Use after memory_search when relationship context is needed.",
    parameters: MemoryGraphQuerySchema,
    execute: async (_toolCallId, params) => {
      const query = readStringParam(params, "query", { required: true });
      const maxResults = readNumberParam(params, "maxResults");
      const maxHops = readNumberParam(params, "maxHops");
      const types = Array.isArray(params?.types)
        ? params.types.map((value: unknown) => String(value).trim()).filter(Boolean)
        : undefined;
      const { manager, error } = await getMemoryGraphManager({
        cfg,
        agentId,
      });
      if (!manager) {
        return jsonResult({ nodes: [], edges: [], disabled: true, error });
      }
      const result = await manager.query({
        query,
        types,
        maxResults,
        maxHops,
        sessionKey: options.agentSessionKey,
      });
      const status = manager.status();
      return jsonResult({
        ...result,
        graph: {
          url: status.url,
          workspaceId: status.workspaceId,
        },
      });
    },
  };
}

export function createMemoryRagTool(options: {
  config?: SurprisebotConfig;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const cfg = options.config;
  if (!cfg) {
    return createDisabledTool({
      label: "Memory GraphRAG",
      name: "memory_rag_query",
      description:
        "Memory GraphRAG is unavailable in this context (config missing).",
      schema: MemoryRagQuerySchema,
      error: "memory search/graph config unavailable",
    });
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  const hasSearch = Boolean(resolveMemorySearchConfig(cfg, agentId));
  const hasGraph = Boolean(resolveMemoryGraphConfig(cfg, agentId));
  if (!hasSearch && !hasGraph) {
    return createDisabledTool({
      label: "Memory GraphRAG",
      name: "memory_rag_query",
      description:
        "Memory GraphRAG is unavailable in this context (memory search and graph disabled).",
      schema: MemoryRagQuerySchema,
      error: "memory search/graph disabled",
    });
  }
  return {
    label: "Memory GraphRAG",
    name: "memory_rag_query",
    description:
      "Hybrid memory retrieval: runs memory_search and memory_graph_query to return both semantic snippets and relationship context.",
    parameters: MemoryRagQuerySchema,
    execute: async (_toolCallId, params) => {
      const query = readStringParam(params, "query", { required: true });
      const maxResults = readNumberParam(params, "maxResults");
      const minScore = readNumberParam(params, "minScore");
      const graphTypes = Array.isArray(params?.graphTypes)
        ? params.graphTypes.map((value: unknown) => String(value).trim()).filter(Boolean)
        : undefined;
      const graphMaxResults = readNumberParam(params, "graphMaxResults");
      const graphMaxHops = readNumberParam(params, "graphMaxHops");

      const searchResult = hasSearch
        ? await getMemorySearchManager({ cfg, agentId })
        : { manager: null, error: "disabled" };
      const graphResult = hasGraph
        ? await getMemoryGraphManager({ cfg, agentId })
        : { manager: null, error: "disabled" };

      let search: unknown = { results: [], disabled: true, error: searchResult.error };
      if (searchResult.manager) {
        const results = await searchResult.manager.search(query, {
          maxResults,
          minScore,
          sessionKey: options.agentSessionKey,
        });
        const status = searchResult.manager.status();
        search = {
          results,
          provider: status.provider,
          model: status.model,
          fallback: status.fallback,
        };
      }

      let graph: MemoryGraphQueryResult & { disabled?: boolean; error?: string } = {
        nodes: [],
        edges: [],
        disabled: true,
        error: graphResult.error,
      };
      if (graphResult.manager) {
        graph = await graphResult.manager.query({
          query,
          types: graphTypes,
          maxResults: graphMaxResults,
          maxHops: graphMaxHops,
          sessionKey: options.agentSessionKey,
        });
      }

      return jsonResult({ search, graph });
    },
  };
}
