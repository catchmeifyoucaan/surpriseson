import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../agents/model-auth.js", () => ({
  resolveApiKeyForProvider: vi.fn(),
}));

const createFetchMock = () =>
  vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ embedding: [1, 2, 3] }] }),
  })) as unknown as typeof fetch;

describe("embedding provider remote overrides", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses remote baseUrl/apiKey and merges headers", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "provider-key",
    });

    const cfg = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://provider.example/v1",
            headers: {
              "X-Provider": "p",
              "X-Shared": "provider",
            },
          },
        },
      },
    };

    const result = await createEmbeddingProvider({
      config: cfg as never,
      provider: "openai",
      remote: {
        baseUrl: "https://remote.example/v1",
        apiKey: "  remote-key  ",
        headers: {
          "X-Shared": "remote",
          "X-Remote": "r",
        },
      },
      model: "text-embedding-3-small",
      fallback: "openai",
    });

    await result.provider.embedQuery("hello");

    expect(authModule.resolveApiKeyForProvider).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://remote.example/v1/embeddings");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer remote-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Provider"]).toBe("p");
    expect(headers["X-Shared"]).toBe("remote");
    expect(headers["X-Remote"]).toBe("r");
  });

  it("falls back to resolved api key when remote apiKey is blank", async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "provider-key",
    });

    const cfg = {
      models: {
        providers: {
          openai: {
            baseUrl: "https://provider.example/v1",
          },
        },
      },
    };

    const result = await createEmbeddingProvider({
      config: cfg as never,
      provider: "openai",
      remote: {
        baseUrl: "https://remote.example/v1",
        apiKey: "   ",
      },
      model: "text-embedding-3-small",
      fallback: "openai",
    });

    await result.provider.embedQuery("hello");

    expect(authModule.resolveApiKeyForProvider).toHaveBeenCalledTimes(1);
    const headers = (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>) ?? {};
    expect(headers.Authorization).toBe("Bearer provider-key");
  });
  it("uses google baseUrl/apiKey and embedContent endpoint", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ embedding: { values: [1, 2, 3] } }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "provider-key",
    });

    const cfg = {
      models: {
        providers: {
          google: {
            baseUrl: "https://provider.example/v1beta",
            headers: {
              "X-Provider": "g",
              "X-Shared": "provider",
            },
          },
        },
      },
    };

    const result = await createEmbeddingProvider({
      config: cfg as never,
      provider: "google",
      remote: {
        baseUrl: "https://remote.example/v1beta",
        apiKey: "  remote-key  ",
        headers: {
          "X-Shared": "remote",
          "X-Remote": "r",
        },
      },
      model: "gemini-embedding-001",
      fallback: "none",
    });

    await result.provider.embedQuery("hello");

    expect(authModule.resolveApiKeyForProvider).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://remote.example/v1beta/models/gemini-embedding-001:embedContent");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("remote-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Provider"]).toBe("g");
    expect(headers["X-Shared"]).toBe("remote");
    expect(headers["X-Remote"]).toBe("r");
    const body = JSON.parse(String(init?.body ?? "{}"));
    expect(body.model).toBe("models/gemini-embedding-001");
    expect(body.content?.parts?.[0]?.text).toBe("hello");
  });

  it("falls back to resolved api key when google remote apiKey is blank", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ embedding: { values: [1, 2, 3] } }),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);

    const { createEmbeddingProvider } = await import("./embeddings.js");
    const authModule = await import("../agents/model-auth.js");
    vi.mocked(authModule.resolveApiKeyForProvider).mockResolvedValue({
      apiKey: "provider-key",
    });

    const cfg = {
      models: {
        providers: {
          google: {
            baseUrl: "https://provider.example/v1beta",
          },
        },
      },
    };

    const result = await createEmbeddingProvider({
      config: cfg as never,
      provider: "google",
      remote: {
        baseUrl: "https://remote.example/v1beta",
        apiKey: "   ",
      },
      model: "gemini-embedding-001",
      fallback: "none",
    });

    await result.provider.embedQuery("hello");

    expect(authModule.resolveApiKeyForProvider).toHaveBeenCalledTimes(1);
    const headers = (fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>) ?? {};
    expect(headers["x-goog-api-key"]).toBe("provider-key");
  });

});
