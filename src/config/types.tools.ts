import type { AgentElevatedAllowFromConfig } from "./types.base.js";

export type ToolProfileId = "minimal" | "coding" | "messaging" | "full";

export type ToolPolicyConfig = {
  allow?: string[];
  deny?: string[];
  profile?: ToolProfileId;
};

export type AgentToolsConfig = {
  /** Base tool profile applied before allow/deny lists. */
  profile?: ToolProfileId;
  allow?: string[];
  deny?: string[];
  /** Optional tool policy overrides keyed by provider id or "provider/model". */
  byProvider?: Record<string, ToolPolicyConfig>;
  /** Per-agent elevated exec gate (can only further restrict global tools.elevated). */
  elevated?: {
    /** Enable or disable elevated mode for this agent (default: true). */
    enabled?: boolean;
    /** Approved senders for /elevated (per-provider allowlists). */
    allowFrom?: AgentElevatedAllowFromConfig;
  };
  sandbox?: {
    tools?: {
      allow?: string[];
      deny?: string[];
    };
  };
};

export type MemorySearchConfig = {
  /** Enable vector memory search (default: true). */
  enabled?: boolean;
  /** Embedding provider mode. */
  provider?: "openai" | "local" | "google" | "gemini";
  remote?: {
    baseUrl?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  };
  /** Fallback behavior when local embeddings fail. */
  fallback?: "openai" | "google" | "gemini" | "none";
  /** Embedding model id (remote) or alias (local). */
  model?: string;
  /** Local embedding settings (node-llama-cpp). */
  local?: {
    /** GGUF model path or hf: URI. */
    modelPath?: string;
    /** Optional cache directory for local models. */
    modelCacheDir?: string;
  };
  /** Index storage configuration. */
  store?: {
    driver?: "sqlite";
    path?: string;
  };
  /** Chunking configuration. */
  chunking?: {
    tokens?: number;
    overlap?: number;
  };
  /** Sync behavior. */
  sync?: {
    onSessionStart?: boolean;
    onSearch?: boolean;
    watch?: boolean;
    watchDebounceMs?: number;
    intervalMinutes?: number;
  };
  /** Query behavior. */
  query?: {
    maxResults?: number;
    minScore?: number;
  };
};

export type MemoryGraphConfig = {
  /** Enable memory graph (default: false). */
  enabled?: boolean;
  /** Neo4j bolt URL (e.g. bolt://127.0.0.1:7687). */
  url?: string;
  /** Neo4j username. */
  username?: string;
  /** Neo4j password. */
  password?: string;
  /** Optional Neo4j database name. */
  database?: string;
  /** Sync behavior. */
  sync?: {
    onSessionStart?: boolean;
    onSearch?: boolean;
    watch?: boolean;
    watchDebounceMs?: number;
    intervalMinutes?: number;
  };
  /** Query behavior. */
  query?: {
    maxResults?: number;
    maxHops?: number;
  };
};

export type ToolsConfig = {
  /** Base tool profile applied before allow/deny lists. */
  profile?: ToolProfileId;
  allow?: string[];
  deny?: string[];
  /** Optional tool policy overrides keyed by provider id or "provider/model". */
  byProvider?: Record<string, ToolPolicyConfig>;
  web?: {
    search?: {
      /** Enable web search tool (default: true when API key is present). */
      enabled?: boolean;
      /** Search provider ("brave", "serper", "serpapi", or "hybrid"). */
      provider?: "brave" | "serper" | "serpapi" | "hybrid";
      /** Brave Search API key (optional; defaults to BRAVE_API_KEY env var). */
      apiKey?: string;
      /** Serper API key (optional; defaults to SERPER_API_KEY env var). */
      serperApiKey?: string;
      /** SerpAPI API key (optional; defaults to SERPAPI_API_KEY env var). */
      serpapiApiKey?: string;
      /** SerpAPI engines to query (default: ["google"]). */
      serpapiEngines?: string[];
      /** Perplexity API key for query expansion (optional; defaults to PPLX_API_KEY env var). */
      perplexityApiKey?: string;
      /** Default search results count (1-10). */
      maxResults?: number;
      /** Timeout in seconds for search requests. */
      timeoutSeconds?: number;
      /** Cache TTL in minutes for search results. */
      cacheTtlMinutes?: number;
      /** Hybrid search configuration. */
      hybrid?: {
        /** Providers to include in hybrid mode (default: brave, serper, serpapi). */
        providers?: Array<"brave" | "serper" | "serpapi">;
        /** Query expansion controls (Perplexity). */
        queryExpansion?: {
          /** Enable query expansion (default: false). */
          enabled?: boolean;
          /** Max extra queries to generate (default: 2). */
          maxQueries?: number;
          /** Perplexity model to use (default: "sonar"). */
          model?: string;
        };
      };
    };
    fetch?: {
      /** Enable web fetch tool (default: false). */
      enabled?: boolean;
      /** Max characters to return from fetched content. */
      maxChars?: number;
      /** Timeout in seconds for fetch requests. */
      timeoutSeconds?: number;
      /** Cache TTL in minutes for fetched content. */
      cacheTtlMinutes?: number;
      /** Override User-Agent header for fetch requests. */
      userAgent?: string;
    };
  };
  audio?: {
    transcription?: {
      /** CLI args (template-enabled). */
      args?: string[];
      timeoutSeconds?: number;
    };
  };
  agentToAgent?: {
    /** Enable agent-to-agent messaging tools. Default: false. */
    enabled?: boolean;
    /** Allowlist of agent ids or patterns (implementation-defined). */
    allow?: string[];
  };
  /** Elevated exec permissions for the host machine. */
  elevated?: {
    /** Enable or disable elevated mode (default: true). */
    enabled?: boolean;
    /** Approved senders for /elevated (per-provider allowlists). */
    allowFrom?: AgentElevatedAllowFromConfig;
  };
  /** Exec tool defaults. */
  exec?: {
    /** Default time (ms) before an exec command auto-backgrounds. */
    backgroundMs?: number;
    /** Default timeout (seconds) before auto-killing exec commands. */
    timeoutSec?: number;
    /** How long to keep finished sessions in memory (ms). */
    cleanupMs?: number;
    /** apply_patch subtool configuration (experimental). */
    applyPatch?: {
      /** Enable apply_patch for OpenAI models (default: false). */
      enabled?: boolean;
      /**
       * Optional allowlist of model ids that can use apply_patch.
       * Accepts either raw ids (e.g. "gpt-5.2") or full ids (e.g. "openai/gpt-5.2").
       */
      allowModels?: string[];
    };
  };
  /** @deprecated Use tools.exec. */
  bash?: {
    /** Default time (ms) before a bash command auto-backgrounds. */
    backgroundMs?: number;
    /** Default timeout (seconds) before auto-killing bash commands. */
    timeoutSec?: number;
    /** How long to keep finished sessions in memory (ms). */
    cleanupMs?: number;
  };
  /** Sub-agent tool policy defaults (deny wins). */
  subagents?: {
    /** Default model selection for spawned sub-agents (string or {primary,fallbacks}). */
    model?: string | { primary?: string; fallbacks?: string[] };
    tools?: {
      allow?: string[];
      deny?: string[];
    };
  };
  /** Sandbox tool policy defaults (deny wins). */
  sandbox?: {
    tools?: {
      allow?: string[];
      deny?: string[];
    };
  };
  /** Tool-result verification and timeout controls. */
  toolResults?: {
    /** Require tool results before sending replies when tools were invoked. */
    strict?: boolean;
    /** Automatically retry once when tool results are missing. */
    retryOnce?: boolean;
    /** Require tool usage for filesystem/command queries. */
    requireToolForQueries?: boolean;
    /** Warn when a tool exceeds this duration (ms) without returning. */
    timeoutMs?: number;
    /** Emit periodic tool heartbeat updates at this interval (ms). */
    heartbeatMs?: number;
    /** Emit user-visible warnings for missing tool results. */
    warnOnMissing?: boolean;
    /** Emit user-visible warnings for tool timeouts. */
    warnOnTimeout?: boolean;
  };
};
