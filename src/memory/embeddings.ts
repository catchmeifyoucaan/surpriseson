import type { Llama, LlamaEmbeddingContext, LlamaModel } from "node-llama-cpp";
import { resolveApiKeyForProvider } from "../agents/model-auth.js";
import type { SurprisebotConfig } from "../config/config.js";

export type EmbeddingProvider = {
  id: string;
  model: string;
  embedQuery: (text: string) => Promise<number[]>;
  embedBatch: (texts: string[]) => Promise<number[][]>;
};

export type EmbeddingProviderResult = {
  provider: EmbeddingProvider;
  requestedProvider: "openai" | "local" | "google";
  fallbackFrom?: "local";
  fallbackReason?: string;
};

export type EmbeddingProviderOptions = {
  config: SurprisebotConfig;
  agentDir?: string;
  provider: "openai" | "local" | "google" | "gemini";
  remote?: {
    baseUrl?: string;
    apiKey?: string;
    headers?: Record<string, string>;
  };
  model: string;
  fallback: "openai" | "google" | "gemini" | "none";
  local?: {
    modelPath?: string;
    modelCacheDir?: string;
  };
};

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_LOCAL_MODEL = "hf:ggml-org/embeddinggemma-300M-GGUF/embeddinggemma-300M-Q8_0.gguf";
const DEFAULT_GOOGLE_MODEL = "gemini-embedding-001";
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_MS = 500;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function normalizeOpenAiModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "text-embedding-3-small";
  if (trimmed.startsWith("openai/")) return trimmed.slice("openai/".length);
  return trimmed;
}

function normalizeGoogleEmbeddingModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return `models/${DEFAULT_GOOGLE_MODEL}`;
  const withoutProvider = trimmed.startsWith("google/")
    ? trimmed.slice("google/".length)
    : trimmed;
  if (withoutProvider.startsWith("models/")) return withoutProvider;
  return `models/${withoutProvider}`;
}

function normalizeEmbeddingProvider(raw: string): "openai" | "local" | "google" {
  const value = raw.trim().toLowerCase();
  if (value === "local") return "local";
  if (value === "google" || value === "gemini") return "google";
  return "openai";
}

function normalizeEmbeddingFallback(raw: EmbeddingProviderOptions["fallback"]): "openai" | "google" | "none" {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "none") return "none";
  if (value === "google" || value === "gemini") return "google";
  if (value === "openai") return "openai";
  return "openai";
}

function coerceNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is number => typeof entry === "number");
}

function extractEmbeddingValues(value: unknown): number[] {
  if (Array.isArray(value)) return coerceNumberArray(value);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const candidate = record.values ?? record.value ?? record.embedding ?? record.vector;
  return coerceNumberArray(candidate);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, seconds) * 1000;
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  opts?: { maxAttempts?: number; baseDelayMs?: number },
): Promise<Response> {
  const maxAttempts = Math.max(1, opts?.maxAttempts ?? DEFAULT_RETRY_ATTEMPTS);
  const baseDelayMs = Math.max(0, opts?.baseDelayMs ?? DEFAULT_RETRY_BASE_MS);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const res = await fetch(url, options);
      if (res.ok || !isRetryableStatus(res.status) || attempt === maxAttempts) {
        return res;
      }
      try {
        await res.arrayBuffer();
      } catch {
        // ignore
      }
      const retryAfterMs = parseRetryAfterMs(res.headers.get("retry-after"));
      const delay = retryAfterMs ?? baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * 100);
      await sleep(delay + jitter);
      continue;
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      const jitter = Math.floor(Math.random() * 100);
      await sleep(delay + jitter);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function createOpenAiEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<EmbeddingProvider> {
  const remote = options.remote;
  const remoteApiKey = remote?.apiKey?.trim();
  const remoteBaseUrl = remote?.baseUrl?.trim();

  const { apiKey } = remoteApiKey
    ? { apiKey: remoteApiKey }
    : await resolveApiKeyForProvider({
        provider: "openai",
        cfg: options.config,
        agentDir: options.agentDir,
      });

  const providerConfig = options.config.models?.providers?.openai;
  const baseUrl = remoteBaseUrl || providerConfig?.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL;
  const url = `${baseUrl.replace(/\/$/, "")}/embeddings`;
  const headerOverrides = Object.assign({}, providerConfig?.headers, remote?.headers);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...headerOverrides,
  };
  const model = normalizeOpenAiModel(options.model);

  const embed = async (input: string[]): Promise<number[][]> => {
    if (input.length === 0) return [];
    const res = await fetchWithRetry(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model, input }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`openai embeddings failed: ${res.status} ${text}`);
    }
    const payload = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const data = payload.data ?? [];
    return data.map((entry) => entry.embedding ?? []);
  };

  return {
    id: "openai",
    model,
    embedQuery: async (text) => {
      const [vec] = await embed([text]);
      return vec ?? [];
    },
    embedBatch: embed,
  };
}

async function createGoogleEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<EmbeddingProvider> {
  const remote = options.remote;
  const remoteApiKey = remote?.apiKey?.trim();
  const remoteBaseUrl = remote?.baseUrl?.trim();

  const { apiKey } = remoteApiKey
    ? { apiKey: remoteApiKey }
    : await resolveApiKeyForProvider({
        provider: "google",
        cfg: options.config,
        agentDir: options.agentDir,
      });

  const providerConfig = options.config.models?.providers?.google;
  const baseUrl = remoteBaseUrl || providerConfig?.baseUrl?.trim() || DEFAULT_GOOGLE_BASE_URL;
  const base = baseUrl.replace(/\/$/, "");
  const headerOverrides = Object.assign({}, providerConfig?.headers, remote?.headers);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
    ...headerOverrides,
  };
  const model = normalizeGoogleEmbeddingModel(options.model);

  const embedContent = async (text: string): Promise<number[]> => {
    const res = await fetchWithRetry(`${base}/${model}:embedContent`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        content: { parts: [{ text }] },
      }),
    });
    if (!res.ok) {
      const payload = await res.text();
      throw new Error(`google embeddings failed: ${res.status} ${payload}`);
    }
    const payload = (await res.json()) as {
      embedding?: unknown;
      embeddings?: unknown[];
    };
    const embedding = payload.embedding ?? (payload.embeddings ? payload.embeddings[0] : undefined);
    return extractEmbeddingValues(embedding);
  };

  const embedBatch = async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return [];
    const requests = texts.map((text) => ({
      model,
      content: { parts: [{ text }] },
    }));
    const res = await fetchWithRetry(`${base}/${model}:batchEmbedContents`, {
      method: "POST",
      headers,
      body: JSON.stringify({ requests }),
    });
    if (!res.ok) {
      const payload = await res.text();
      throw new Error(`google embeddings failed: ${res.status} ${payload}`);
    }
    const payload = (await res.json()) as {
      embeddings?: unknown[];
      embedding?: unknown;
    };
    const embeddings =
      payload.embeddings ?? (payload.embedding ? [payload.embedding] : []);
    return embeddings.map(extractEmbeddingValues);
  };

  return {
    id: "google",
    model,
    embedQuery: embedContent,
    embedBatch,
  };
}

async function createLocalEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<EmbeddingProvider> {
  const modelPath = options.local?.modelPath?.trim() || DEFAULT_LOCAL_MODEL;
  const modelCacheDir = options.local?.modelCacheDir?.trim();

  // Lazy-load node-llama-cpp to keep startup light unless local is enabled.
  const { getLlama, resolveModelFile, LlamaLogLevel } = await import("node-llama-cpp");

  let llama: Llama | null = null;
  let embeddingModel: LlamaModel | null = null;
  let embeddingContext: LlamaEmbeddingContext | null = null;

  const ensureContext = async () => {
    if (!llama) {
      llama = await getLlama({ logLevel: LlamaLogLevel.error });
    }
    if (!embeddingModel) {
      const resolved = await resolveModelFile(modelPath, modelCacheDir || undefined);
      embeddingModel = await llama.loadModel({ modelPath: resolved });
    }
    if (!embeddingContext) {
      embeddingContext = await embeddingModel.createEmbeddingContext();
    }
    return embeddingContext;
  };

  return {
    id: "local",
    model: modelPath,
    embedQuery: async (text) => {
      const ctx = await ensureContext();
      const embedding = await ctx.getEmbeddingFor(text);
      return Array.from(embedding.vector) as number[];
    },
    embedBatch: async (texts) => {
      const ctx = await ensureContext();
      const embeddings = await Promise.all(
        texts.map(async (text) => {
          const embedding = await ctx.getEmbeddingFor(text);
          return Array.from(embedding.vector) as number[];
        }),
      );
      return embeddings;
    },
  };
}

export async function createEmbeddingProvider(
  options: EmbeddingProviderOptions,
): Promise<EmbeddingProviderResult> {
  const requestedProvider = normalizeEmbeddingProvider(options.provider);
  const fallback = normalizeEmbeddingFallback(options.fallback);
  if (requestedProvider === "local") {
    try {
      const provider = await createLocalEmbeddingProvider(options);
      return { provider, requestedProvider };
    } catch (err) {
      const reason = formatLocalSetupError(err);
      if (fallback === "openai") {
        try {
          const provider = await createOpenAiEmbeddingProvider(options);
          return {
            provider,
            requestedProvider,
            fallbackFrom: "local",
            fallbackReason: reason,
          };
        } catch (fallbackErr) {
          throw new Error(`${reason}\n\nFallback to OpenAI failed: ${formatError(fallbackErr)}`);
        }
      }
      if (fallback === "google") {
        try {
          const provider = await createGoogleEmbeddingProvider(options);
          return {
            provider,
            requestedProvider,
            fallbackFrom: "local",
            fallbackReason: reason,
          };
        } catch (fallbackErr) {
          throw new Error(`${reason}\n\nFallback to Google failed: ${formatError(fallbackErr)}`);
        }
      }
      throw new Error(reason);
    }
  }
  if (requestedProvider === "google") {
    const provider = await createGoogleEmbeddingProvider(options);
    return { provider, requestedProvider };
  }
  const provider = await createOpenAiEmbeddingProvider(options);
  return { provider, requestedProvider };
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function formatLocalSetupError(err: unknown): string {
  const detail = formatError(err);
  return [
    "Local embeddings unavailable.",
    detail ? `Reason: ${detail}` : undefined,
    "To enable local embeddings:",
    "1) pnpm approve-builds",
    "2) select node-llama-cpp",
    "3) pnpm rebuild node-llama-cpp",
    'Or set agents.defaults.memorySearch.provider = "openai" or "google" (remote).',
  ]
    .filter(Boolean)
    .join("\n");
}
