import { Type } from "@sinclair/typebox";

import type { SurprisebotConfig } from "../../config/config.js";
import { resolveSessionAgentId, resolveDefaultAgentId } from "../agent-scope.js";
import { getJobContext, incrementJobQueryCount } from "../../infra/job-context.js";
import { resolveBudgetCaps } from "../../infra/budget-manager.js";
import { VERSION } from "../../version.js";
import { stringEnum } from "../schema/typebox.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const SEARCH_PROVIDERS = ["brave", "serper", "serpapi", "hybrid"] as const;
const EXTRACT_MODES = ["markdown", "text"] as const;

const DEFAULT_SEARCH_COUNT = 5;
const MAX_SEARCH_COUNT = 10;
const DEFAULT_FETCH_MAX_CHARS = 50_000;
const DEFAULT_TIMEOUT_SECONDS = 30;
const DEFAULT_CACHE_TTL_MINUTES = 15;
const DEFAULT_CACHE_MAX_ENTRIES = 100;
const DEFAULT_QUERY_EXPANSION_MAX = 2;
const DEFAULT_QUERY_EXPANSION_MODEL = "sonar";
const DEFAULT_SERPAPI_ENGINES = ["google"];

const BRAVE_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const SERPER_SEARCH_ENDPOINT = "https://google.serper.dev/search";
const SERPAPI_SEARCH_ENDPOINT = "https://serpapi.com/search.json";
const PPLX_CHAT_ENDPOINT = "https://api.perplexity.ai/chat/completions";

type WebSearchConfig = NonNullable<SurprisebotConfig["tools"]>["web"] extends infer Web
  ? Web extends { search?: infer Search }
    ? Search
    : undefined
  : undefined;

type WebFetchConfig = NonNullable<SurprisebotConfig["tools"]>["web"] extends infer Web
  ? Web extends { fetch?: infer Fetch }
    ? Fetch
    : undefined
  : undefined;

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
  insertedAt: number;
};

const SEARCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();
const FETCH_CACHE = new Map<string, CacheEntry<Record<string, unknown>>>();

const WebSearchSchema = Type.Object({
  query: Type.String({ description: "Search query string." }),
  count: Type.Optional(
    Type.Number({
      description: "Number of results to return (1-10).",
      minimum: 1,
      maximum: MAX_SEARCH_COUNT,
    }),
  ),
});

const WebFetchSchema = Type.Object({
  url: Type.String({ description: "HTTP or HTTPS URL to fetch." }),
  extractMode: Type.Optional(
    stringEnum(EXTRACT_MODES, {
      description: 'Extraction mode ("markdown" or "text").',
      default: "markdown",
    }),
  ),
  maxChars: Type.Optional(
    Type.Number({
      description: "Maximum characters to return (truncates when exceeded).",
      minimum: 100,
    }),
  ),
});

type BraveSearchResult = {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
};

type BraveSearchResponse = {
  web?: {
    results?: BraveSearchResult[];
  };
};

type SerperSearchResult = {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
};

type SerperSearchResponse = {
  organic?: SerperSearchResult[];
};

type SerpApiSearchResult = {
  title?: string;
  link?: string;
  snippet?: string;
  date?: string;
};

type SerpApiSearchResponse = {
  organic_results?: SerpApiSearchResult[];
  error?: string;
};

type PerplexityResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

function resolveSearchConfig(cfg?: SurprisebotConfig): WebSearchConfig {
  const search = cfg?.tools?.web?.search;
  if (!search || typeof search !== "object") return undefined;
  return search as WebSearchConfig;
}

function resolveFetchConfig(cfg?: SurprisebotConfig): WebFetchConfig {
  const fetch = cfg?.tools?.web?.fetch;
  if (!fetch || typeof fetch !== "object") return undefined;
  return fetch as WebFetchConfig;
}

function resolveSearchEnabled(params: { search?: WebSearchConfig; sandboxed?: boolean }): boolean {
  if (typeof params.search?.enabled === "boolean") return params.search.enabled;
  if (params.sandboxed) return true;
  return true;
}

function resolveFetchEnabled(params: { fetch?: WebFetchConfig; sandboxed?: boolean }): boolean {
  if (typeof params.fetch?.enabled === "boolean") return params.fetch.enabled;
  return true;
}

function resolveBraveKey(search?: WebSearchConfig): string | undefined {
  const fromConfig =
    search && "apiKey" in search && typeof search.apiKey === "string" ? search.apiKey.trim() : "";
  const fromEnv = (process.env.BRAVE_API_KEY ?? "").trim();
  return fromConfig || fromEnv || undefined;
}

function resolveSerperKey(search?: WebSearchConfig): string | undefined {
  const fromConfig =
    search && "serperApiKey" in search && typeof search.serperApiKey === "string"
      ? search.serperApiKey.trim()
      : "";
  const fromEnv = (process.env.SERPER_API_KEY ?? "").trim();
  return fromConfig || fromEnv || undefined;
}

function resolveSerpApiKey(search?: WebSearchConfig): string | undefined {
  const fromConfig =
    search && "serpapiApiKey" in search && typeof search.serpapiApiKey === "string"
      ? search.serpapiApiKey.trim()
      : "";
  const fromEnv = (process.env.SERPAPI_API_KEY ?? "").trim();
  return fromConfig || fromEnv || undefined;
}

function resolveSerpApiEngines(search?: WebSearchConfig): string[] {
  const configured =
    search && "serpapiEngines" in search && Array.isArray(search.serpapiEngines)
      ? search.serpapiEngines
      : undefined;
  const normalized = (configured ?? DEFAULT_SERPAPI_ENGINES)
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  const unique = Array.from(new Set(normalized));
  return unique.length > 0 ? unique : DEFAULT_SERPAPI_ENGINES;
}

function resolvePerplexityKey(search?: WebSearchConfig): string | undefined {
  const fromConfig =
    search && "perplexityApiKey" in search && typeof search.perplexityApiKey === "string"
      ? search.perplexityApiKey.trim()
      : "";
  const fromEnv = (process.env.PPLX_API_KEY ?? "").trim();
  return fromConfig || fromEnv || undefined;
}

function missingSearchKeyPayload(params: {
  provider: string;
  missing: string[];
}) {
  const list = params.missing.join(", ");
  return {
    error: "missing_search_api_key",
    message: `web_search (${params.provider}) needs API keys: ${list}. Configure tools.web.search.* or set env vars.`,
    docs: "https://docs.surprisebot.bot/tools/web",
  };
}

function resolveSearchProvider(search?: WebSearchConfig): (typeof SEARCH_PROVIDERS)[number] {
  const raw =
    search && "provider" in search && typeof search.provider === "string"
      ? search.provider.trim().toLowerCase()
      : "";
  if (raw === "serper") return "serper";
  if (raw === "serpapi") return "serpapi";
  if (raw === "hybrid") return "hybrid";
  return "brave";
}

function resolveHybridProviders(search?: WebSearchConfig): Array<"brave" | "serper" | "serpapi"> {
  const configured =
    search && "hybrid" in search && search.hybrid && Array.isArray(search.hybrid.providers)
      ? search.hybrid.providers
      : undefined;
  const normalized = (configured ?? ["brave", "serper", "serpapi"]).map((entry) =>
    entry.trim().toLowerCase(),
  );
  const providers = normalized.filter(
    (entry): entry is "brave" | "serper" | "serpapi" =>
      entry === "brave" || entry === "serper" || entry === "serpapi",
  );
  return providers.length > 0 ? providers : ["brave"];
}

function resolveQueryExpansion(search?: WebSearchConfig): {
  enabled: boolean;
  maxQueries: number;
  model: string;
} {
  const cfg = search && "hybrid" in search ? search.hybrid?.queryExpansion : undefined;
  const enabled = Boolean(cfg?.enabled);
  const maxQueries =
    typeof cfg?.maxQueries === "number" && Number.isFinite(cfg.maxQueries)
      ? Math.max(1, Math.floor(cfg.maxQueries))
      : DEFAULT_QUERY_EXPANSION_MAX;
  const model = cfg?.model?.trim() || DEFAULT_QUERY_EXPANSION_MODEL;
  return { enabled, maxQueries, model };
}

function resolveTimeoutSeconds(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.floor(parsed));
}

function resolveCacheTtlMs(value: unknown, fallbackMinutes: number): number {
  const minutes =
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallbackMinutes;
  return Math.round(minutes * 60_000);
}

function resolveMaxChars(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(100, Math.floor(parsed));
}

function resolveSearchCount(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = Math.max(1, Math.min(MAX_SEARCH_COUNT, Math.floor(parsed)));
  return clamped;
}

function normalizeCacheKey(value: string): string {
  return value.trim().toLowerCase();
}

function readCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
): { value: T; cached: boolean } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return { value: entry.value, cached: true };
}

function writeCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, ttlMs: number) {
  if (ttlMs <= 0) return;
  if (cache.size >= DEFAULT_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    insertedAt: Date.now(),
  });
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (timeoutMs <= 0) return signal ?? new AbortController().signal;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        controller.abort();
      },
      { once: true },
    );
  }
  controller.signal.addEventListener(
    "abort",
    () => {
      clearTimeout(timer);
    },
    { once: true },
  );
  return controller.signal;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gi, (_, dec) => String.fromCharCode(Number.parseInt(dec, 10)));
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, ""));
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function htmlToMarkdown(html: string): { text: string; title?: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? normalizeWhitespace(stripTags(titleMatch[1])) : undefined;
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
  text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, body) => {
    const label = normalizeWhitespace(stripTags(body));
    if (!label) return href;
    return `[${label}](${href})`;
  });
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, body) => {
    const prefix = "#".repeat(Math.max(1, Math.min(6, Number.parseInt(level, 10))));
    const label = normalizeWhitespace(stripTags(body));
    return `\n${prefix} ${label}\n`;
  });
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, body) => {
    const label = normalizeWhitespace(stripTags(body));
    return label ? `\n- ${label}` : "";
  });
  text = text
    .replace(/<(br|hr)\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|table|tr|ul|ol)>/gi, "\n");
  text = stripTags(text);
  text = normalizeWhitespace(text);
  return { text, title };
}

function htmlToText(html: string): { text: string; title?: string } {
  const { text, title } = htmlToMarkdown(html);
  return { text, title };
}

function truncateText(value: string, maxChars: number): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: false };
  return { text: value.slice(0, maxChars), truncated: true };
}

function resolveSiteName(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

async function readResponseText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function parseQueryList(raw: string, maxItems: number): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const jsonMatch = trimmed.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter(Boolean)
          .slice(0, maxItems);
      }
    } catch {
      // fall through to line parsing
    }
  }
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.]+\s*/, "").trim())
    .filter(Boolean);
  return lines.slice(0, maxItems);
}

async function expandQueriesWithPerplexity(params: {
  query: string;
  apiKey: string;
  model: string;
  maxQueries: number;
  timeoutSeconds: number;
}): Promise<{ queries: string[]; error?: string }> {
  const prompt = [
    "You are a search query expansion engine.",
    `Return a JSON array of up to ${params.maxQueries} alternative search queries.`,
    "Do not include explanations. Output only the JSON array.",
  ].join(" ");
  const res = await fetch(PPLX_CHAT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.2,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: params.query },
      ],
    }),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });
  if (!res.ok) {
    const detail = await readResponseText(res);
    return { queries: [], error: detail || res.statusText };
  }
  const data = (await res.json()) as PerplexityResponse;
  const content = data.choices?.[0]?.message?.content ?? "";
  const queries = parseQueryList(content, params.maxQueries);
  return { queries, error: undefined };
}

type NormalizedSearchResult = {
  title: string;
  url: string;
  description: string;
  published?: string;
  siteName?: string;
  provider: string;
};

async function runBraveSearch(params: {
  query: string;
  count: number;
  apiKey: string;
  timeoutSeconds: number;
}): Promise<NormalizedSearchResult[]> {
  const url = new URL(BRAVE_SEARCH_ENDPOINT);
  url.searchParams.set("q", params.query);
  url.searchParams.set("count", String(params.count));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": params.apiKey,
    },
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`Brave Search API error (${res.status}): ${detail || res.statusText}`);
  }

  const data = (await res.json()) as BraveSearchResponse;
  const results = Array.isArray(data.web?.results) ? (data.web?.results ?? []) : [];
  return results.map((entry) => ({
    title: entry.title ?? "",
    url: entry.url ?? "",
    description: entry.description ?? "",
    published: entry.age ?? undefined,
    siteName: resolveSiteName(entry.url ?? ""),
    provider: "brave",
  }));
}

async function runSerperSearch(params: {
  query: string;
  count: number;
  apiKey: string;
  timeoutSeconds: number;
}): Promise<NormalizedSearchResult[]> {
  const res = await fetch(SERPER_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": params.apiKey,
    },
    body: JSON.stringify({ q: params.query, num: params.count }),
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });
  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`Serper API error (${res.status}): ${detail || res.statusText}`);
  }
  const data = (await res.json()) as SerperSearchResponse;
  const results = Array.isArray(data.organic) ? data.organic : [];
  return results.map((entry) => ({
    title: entry.title ?? "",
    url: entry.link ?? "",
    description: entry.snippet ?? "",
    published: entry.date ?? undefined,
    siteName: resolveSiteName(entry.link ?? ""),
    provider: "serper",
  }));
}

async function runSerpApiSearch(params: {
  query: string;
  count: number;
  apiKey: string;
  timeoutSeconds: number;
  engine: string;
}): Promise<NormalizedSearchResult[]> {
  const url = new URL(SERPAPI_SEARCH_ENDPOINT);
  url.searchParams.set("engine", params.engine);
  url.searchParams.set("q", params.query);
  url.searchParams.set("num", String(params.count));
  url.searchParams.set("api_key", params.apiKey);
  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });
  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`SerpAPI error (${res.status}): ${detail || res.statusText}`);
  }
  const data = (await res.json()) as SerpApiSearchResponse;
  if (data.error) {
    throw new Error(`SerpAPI error: ${data.error}`);
  }
  const results = Array.isArray(data.organic_results) ? data.organic_results : [];
  return results.map((entry) => ({
    title: entry.title ?? "",
    url: entry.link ?? "",
    description: entry.snippet ?? "",
    published: entry.date ?? undefined,
    siteName: resolveSiteName(entry.link ?? ""),
    provider: `serpapi:${params.engine}`,
  }));
}

function dedupeResults(results: NormalizedSearchResult[]): NormalizedSearchResult[] {
  const seen = new Set<string>();
  const deduped: NormalizedSearchResult[] = [];
  for (const result of results) {
    const key = normalizeCacheKey(result.url || result.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(result);
  }
  return deduped;
}

async function runHybridSearch(params: {
  query: string;
  count: number;
  timeoutSeconds: number;
  cacheTtlMs: number;
  searchConfig?: WebSearchConfig;
  keys: {
    brave?: string;
    serper?: string;
    serpapi?: string;
    perplexity?: string;
  };
}): Promise<Record<string, unknown>> {
  const providers = resolveHybridProviders(params.searchConfig);
  const expansion = resolveQueryExpansion(params.searchConfig);
  const serpapiEngines = resolveSerpApiEngines(params.searchConfig);
  const cacheKey = normalizeCacheKey(
    `hybrid:${params.query}:${params.count}:${providers.join(",")}:${serpapiEngines.join(",")}:${expansion.enabled}`,
  );
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) return { ...cached.value, cached: true };

  const expandedQueries: string[] = [];
  let expansionError: string | undefined;
  if (expansion.enabled) {
    if (!params.keys.perplexity) {
      expansionError = "missing_perplexity_api_key";
    } else {
      const expansionResult = await expandQueriesWithPerplexity({
        query: params.query,
        apiKey: params.keys.perplexity,
        model: expansion.model,
        maxQueries: expansion.maxQueries,
        timeoutSeconds: params.timeoutSeconds,
      });
      expandedQueries.push(...expansionResult.queries);
      expansionError = expansionResult.error;
    }
  }

  const queryList = [params.query, ...expandedQueries].filter((value, index, arr) => {
    const normalized = normalizeCacheKey(value);
    if (!normalized) return false;
    return arr.findIndex((entry) => normalizeCacheKey(entry) === normalized) === index;
  });
  const perQueryCount = Math.max(1, Math.floor(params.count / Math.max(1, queryList.length)));
  const perEngineCount = Math.max(
    1,
    Math.floor(perQueryCount / Math.max(1, serpapiEngines.length)),
  );

  const sources: Array<{ provider: string; count: number; error?: string; tookMs?: number }> = [];
  const merged: NormalizedSearchResult[] = [];

  for (const provider of providers) {
    const key =
      provider === "brave"
        ? params.keys.brave
        : provider === "serper"
          ? params.keys.serper
          : params.keys.serpapi;
    if (!key) {
      sources.push({ provider, count: 0, error: "missing_api_key" });
      continue;
    }
    const start = Date.now();
    let results: NormalizedSearchResult[] = [];
    let error: string | undefined;
    try {
      const perQueryResults = await Promise.all(
        queryList.map(async (query) => {
          if (provider === "brave") {
            return runBraveSearch({ query, count: perQueryCount, apiKey: key, timeoutSeconds: params.timeoutSeconds });
          }
          if (provider === "serper") {
            return runSerperSearch({ query, count: perQueryCount, apiKey: key, timeoutSeconds: params.timeoutSeconds });
          }
          const perEngineResults = await Promise.all(
            serpapiEngines.map((engine) =>
              runSerpApiSearch({
                query,
                count: perEngineCount,
                apiKey: key,
                timeoutSeconds: params.timeoutSeconds,
                engine,
              }),
            ),
          );
          return perEngineResults.flat();
        }),
      );
      results = perQueryResults.flat();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    sources.push({ provider, count: results.length, error, tookMs: Date.now() - start });
    merged.push(...results);
  }

  const deduped = dedupeResults(merged);
  const payload = {
    query: params.query,
    provider: "hybrid",
    count: deduped.length,
    tookMs: sources.reduce((acc, entry) => acc + (entry.tookMs ?? 0), 0),
    expandedQueries,
    expansionError,
    sources,
    results: deduped,
  };
  writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}

async function runWebSearch(params: {
  query: string;
  count: number;
  timeoutSeconds: number;
  cacheTtlMs: number;
  provider: (typeof SEARCH_PROVIDERS)[number];
  searchConfig?: WebSearchConfig;
  keys: {
    brave?: string;
    serper?: string;
    serpapi?: string;
    perplexity?: string;
  };
}): Promise<Record<string, unknown>> {
  const serpapiEngines = resolveSerpApiEngines(params.searchConfig);
  const cacheKey = normalizeCacheKey(
    `${params.provider}:${params.query}:${params.count}:${params.provider === "serpapi" ? serpapiEngines.join(",") : ""}`,
  );
  const cached = readCache(SEARCH_CACHE, cacheKey);
  if (cached) return { ...cached.value, cached: true };

  const start = Date.now();
  let results: NormalizedSearchResult[] = [];
  if (params.provider === "brave") {
    results = await runBraveSearch({
      query: params.query,
      count: params.count,
      apiKey: params.keys.brave ?? "",
      timeoutSeconds: params.timeoutSeconds,
    });
  } else if (params.provider === "serper") {
    results = await runSerperSearch({
      query: params.query,
      count: params.count,
      apiKey: params.keys.serper ?? "",
      timeoutSeconds: params.timeoutSeconds,
    });
  } else if (params.provider === "serpapi") {
    const perEngineCount = Math.max(1, Math.floor(params.count / Math.max(1, serpapiEngines.length)));
    const perEngineResults = await Promise.all(
      serpapiEngines.map((engine) =>
        runSerpApiSearch({
          query: params.query,
          count: perEngineCount,
          apiKey: params.keys.serpapi ?? "",
          timeoutSeconds: params.timeoutSeconds,
          engine,
        }),
      ),
    );
    results = perEngineResults.flat();
  } else if (params.provider === "hybrid") {
    return runHybridSearch({
      query: params.query,
      count: params.count,
      timeoutSeconds: params.timeoutSeconds,
      cacheTtlMs: params.cacheTtlMs,
      searchConfig: params.searchConfig,
      keys: params.keys,
    });
  } else {
    throw new Error("Unsupported web search provider.");
  }

  const payload = {
    query: params.query,
    provider: params.provider,
    count: results.length,
    tookMs: Date.now() - start,
    results,
  };
  writeCache(SEARCH_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}

async function runWebFetch(params: {
  url: string;
  extractMode: (typeof EXTRACT_MODES)[number];
  maxChars: number;
  timeoutSeconds: number;
  cacheTtlMs: number;
  userAgent: string;
}): Promise<Record<string, unknown>> {
  const cacheKey = normalizeCacheKey(
    `fetch:${params.url}:${params.extractMode}:${params.maxChars}`,
  );
  const cached = readCache(FETCH_CACHE, cacheKey);
  if (cached) return { ...cached.value, cached: true };

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(params.url);
  } catch {
    throw new Error("Invalid URL: must be http or https");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Invalid URL: must be http or https");
  }

  const start = Date.now();
  const res = await fetch(parsedUrl.toString(), {
    method: "GET",
    headers: {
      Accept: "*/*",
      "User-Agent": params.userAgent,
    },
    signal: withTimeout(undefined, params.timeoutSeconds * 1000),
  });

  if (!res.ok) {
    const detail = await readResponseText(res);
    throw new Error(`Web fetch failed (${res.status}): ${detail || res.statusText}`);
  }

  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const body = await readResponseText(res);

  let title: string | undefined;
  let text = body;
  if (contentType.includes("text/html")) {
    const parsed = params.extractMode === "text" ? htmlToText(body) : htmlToMarkdown(body);
    text = parsed.text;
    title = parsed.title;
  } else if (contentType.includes("application/json")) {
    try {
      text = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      text = body;
    }
  }

  const truncated = truncateText(text, params.maxChars);
  const payload = {
    url: params.url,
    finalUrl: res.url || params.url,
    status: res.status,
    contentType,
    title,
    extractMode: params.extractMode,
    truncated: truncated.truncated,
    length: truncated.text.length,
    fetchedAt: new Date().toISOString(),
    tookMs: Date.now() - start,
    text: truncated.text,
  };
  writeCache(FETCH_CACHE, cacheKey, payload, params.cacheTtlMs);
  return payload;
}

export function createWebSearchTool(options?: {
  config?: SurprisebotConfig;
  sandboxed?: boolean;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const search = resolveSearchConfig(options?.config);
  if (!resolveSearchEnabled({ search, sandboxed: options?.sandboxed })) return null;
  return {
    label: "Web Search",
    name: "web_search",
    description:
      "Search the web using Brave, Serper, SerpAPI, or Hybrid mode. Returns titles, URLs, and snippets for fast research.",
    parameters: WebSearchSchema,
    execute: async (_toolCallId, args) => {
      const cfg = options?.config ?? undefined;
      const sessionKey = options?.agentSessionKey;
      const agentId =
        resolveSessionAgentId({ sessionKey, config: cfg }) ??
        resolveDefaultAgentId(cfg ?? ({} as SurprisebotConfig));
      const jobContext = getJobContext(sessionKey);
      const caps = resolveBudgetCaps({
        cfg: cfg ?? ({} as SurprisebotConfig),
        agentId: agentId ?? "default",
        jobType: jobContext?.jobType ?? undefined,
      });
      if (jobContext && typeof caps.queryLimit === "number" && caps.queryLimit >= 0) {
        const count = incrementJobQueryCount(sessionKey) ?? 0;
        if (count > caps.queryLimit) {
          return jsonResult({
            error: "query budget exceeded",
            queryCount: count,
            queryLimit: caps.queryLimit,
            jobType: jobContext.jobType ?? null,
          });
        }
      }
      const keys = {
        brave: resolveBraveKey(search),
        serper: resolveSerperKey(search),
        serpapi: resolveSerpApiKey(search),
        perplexity: resolvePerplexityKey(search),
      };
      const provider = resolveSearchProvider(search);
      if (provider !== "hybrid") {
        const required =
          provider === "brave"
            ? keys.brave
            : provider === "serper"
              ? keys.serper
              : keys.serpapi;
        if (!required) {
          const missing =
            provider === "brave"
              ? ["BRAVE_API_KEY"]
              : provider === "serper"
                ? ["SERPER_API_KEY"]
                : ["SERPAPI_API_KEY"];
          return jsonResult(missingSearchKeyPayload({ provider, missing }));
        }
      } else {
        const configuredProviders = resolveHybridProviders(search);
        const missing: string[] = [];
        if (configuredProviders.includes("brave") && !keys.brave) missing.push("BRAVE_API_KEY");
        if (configuredProviders.includes("serper") && !keys.serper) missing.push("SERPER_API_KEY");
        if (configuredProviders.includes("serpapi") && !keys.serpapi) missing.push("SERPAPI_API_KEY");
        if (missing.length === configuredProviders.length) {
          return jsonResult(missingSearchKeyPayload({ provider: "hybrid", missing }));
        }
      }
      const params = args as Record<string, unknown>;
      const query = readStringParam(params, "query", { required: true });
      const count =
        readNumberParam(params, "count", { integer: true }) ?? search?.maxResults ?? undefined;
      const result = await runWebSearch({
        query,
        count: resolveSearchCount(count, DEFAULT_SEARCH_COUNT),
        timeoutSeconds: resolveTimeoutSeconds(search?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
        cacheTtlMs: resolveCacheTtlMs(search?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES),
        provider,
        searchConfig: search,
        keys,
      });
      return jsonResult(result);
    },
  };
}

export function createWebFetchTool(options?: {
  config?: SurprisebotConfig;
  sandboxed?: boolean;
  agentSessionKey?: string;
}): AnyAgentTool | null {
  const fetch = resolveFetchConfig(options?.config);
  if (!resolveFetchEnabled({ fetch, sandboxed: options?.sandboxed })) return null;
  const userAgent =
    (fetch && "userAgent" in fetch && typeof fetch.userAgent === "string" && fetch.userAgent) ||
    `surprisebot/${VERSION}`;
  return {
    label: "Web Fetch",
    name: "web_fetch",
    description:
      "Fetch and extract readable content from a URL (HTML → markdown/text). Use for lightweight page access without browser automation.",
    parameters: WebFetchSchema,
    execute: async (_toolCallId, args) => {
      const cfg = options?.config ?? undefined;
      const sessionKey = options?.agentSessionKey;
      const agentId =
        resolveSessionAgentId({ sessionKey, config: cfg }) ??
        resolveDefaultAgentId(cfg ?? ({} as SurprisebotConfig));
      const jobContext = getJobContext(sessionKey);
      const caps = resolveBudgetCaps({
        cfg: cfg ?? ({} as SurprisebotConfig),
        agentId: agentId ?? "default",
        jobType: jobContext?.jobType ?? undefined,
      });
      if (jobContext && typeof caps.queryLimit === "number" && caps.queryLimit >= 0) {
        const count = incrementJobQueryCount(sessionKey) ?? 0;
        if (count > caps.queryLimit) {
          return jsonResult({
            error: "query budget exceeded",
            queryCount: count,
            queryLimit: caps.queryLimit,
            jobType: jobContext.jobType ?? null,
          });
        }
      }
      const params = args as Record<string, unknown>;
      const url = readStringParam(params, "url", { required: true });
      const extractMode = readStringParam(params, "extractMode") === "text" ? "text" : "markdown";
      const maxChars = readNumberParam(params, "maxChars", { integer: true });
      const result = await runWebFetch({
        url,
        extractMode,
        maxChars: resolveMaxChars(maxChars ?? fetch?.maxChars, DEFAULT_FETCH_MAX_CHARS),
        timeoutSeconds: resolveTimeoutSeconds(fetch?.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS),
        cacheTtlMs: resolveCacheTtlMs(fetch?.cacheTtlMinutes, DEFAULT_CACHE_TTL_MINUTES),
        userAgent,
      });
      return jsonResult(result);
    },
  };
}
