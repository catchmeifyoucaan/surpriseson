---
summary: "Web search + fetch tools (Brave/Serper/SerpAPI + Hybrid)"
read_when:
  - You want to enable web_search or web_fetch
  - You need web search API key setup
---

# Web tools

Surprisebot ships two lightweight web tools:

- `web_search` — Brave / Serper / SerpAPI queries (fast, structured results), plus Hybrid mode.
- `web_fetch` — HTTP fetch + readable extraction (HTML → markdown/text).

These are **not** browser automation. For JS-heavy sites or logins, use the
[Browser tool](/tools/browser).

## How it works

- `web_search` calls a configured provider and returns structured results
  (title, URL, snippet). No browser is involved.
- Results are cached by query for 15 minutes (configurable).
- `web_fetch` does a plain HTTP GET and extracts readable content
  (HTML → markdown/text). It does **not** execute JavaScript.
- `web_fetch` is enabled by default (unless explicitly disabled).

## Web search API keys

You can use **one or more** providers:

| Provider | Config key | Env var |
| --- | --- | --- |
| Brave | `tools.web.search.apiKey` | `BRAVE_API_KEY` |
| Serper | `tools.web.search.serperApiKey` | `SERPER_API_KEY` |
| SerpAPI | `tools.web.search.serpapiApiKey` | `SERPAPI_API_KEY` |
| Perplexity (query expansion) | `tools.web.search.perplexityApiKey` | `PPLX_API_KEY` |

Hybrid mode can combine Brave + Serper + SerpAPI, and optionally uses
Perplexity to expand queries.

### Getting a Brave API key

1) Create a Brave Search API account at https://brave.com/search/api/
2) In the dashboard, choose the **Data for Search** plan (not “Data for AI”) and generate an API key.
3) Run `surprisebot configure --section web` to store the key in config (recommended), or set `BRAVE_API_KEY` in your environment.

Brave provides a free tier plus paid plans; check the Brave API portal for the
current limits and pricing.

### Where to set keys (recommended)

**Recommended:** run `surprisebot configure --section web`. It stores the key in
`~/.surprisebot/surprisebot.json` under `tools.web.search`.

**Environment alternative:** set `BRAVE_API_KEY`, `SERPER_API_KEY`,
`SERPAPI_API_KEY`, and/or `PPLX_API_KEY` in the Gateway process
environment. For a daemon install, put it in `~/.surprisebot/.env` (or your
service environment). See [Env vars](/start/faq#how-does-surprisebot-load-environment-variables).

## web_search

Search the web with Brave, Serper, SerpAPI, or Hybrid mode.

### Requirements

- `tools.web.search.enabled` must not be `false` (default: enabled)
- Provider API key (Brave/Serper/SerpAPI). For Hybrid mode, any two are sufficient,
  but best results use all three.

### Config

```json5
{
  tools: {
    web: {
      search: {
        enabled: true,
        provider: "hybrid", // brave | serper | serpapi | hybrid
        apiKey: "BRAVE_API_KEY_HERE", // optional if BRAVE_API_KEY is set
        serperApiKey: "SERPER_API_KEY_HERE",
        serpapiApiKey: "SERPAPI_API_KEY_HERE",
        serpapiEngines: ["google", "yandex", "yahoo"],
        perplexityApiKey: "PPLX_API_KEY_HERE",
        maxResults: 6,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
        hybrid: {
          providers: ["brave", "serper", "serpapi"],
          queryExpansion: {
            enabled: true,
            maxQueries: 2,
            model: "sonar"
          }
        }
      }
    }
  }
}
```

### Hybrid mode tips

- Use Hybrid for dorking or breadth-first recon.
- For Yandex/Yahoo/Google-specific dorks, set `serpapiEngines` and pair Hybrid with the
  [Browser tool](/tools/browser) for JS-heavy pages.

### Tool parameters

- `query` (required)
- `count` (1–10; default from config)

## web_fetch

Fetch a URL and extract readable content.

### Requirements

- `tools.web.fetch.enabled` must not be `false` (default: enabled)

### Config

```json5
{
  tools: {
    web: {
      fetch: {
        enabled: true,
        maxChars: 50000,
        timeoutSeconds: 30,
        cacheTtlMinutes: 15,
        userAgent: "surprisebot/2026.1.14-1"
      }
    }
  }
}
```

### Tool parameters

- `url` (required, http/https only)
- `extractMode` (`markdown` | `text`)
- `maxChars` (truncate long pages)

Notes:
- `web_fetch` is best-effort extraction; some sites will need the browser tool.
- Responses are cached (default 15 minutes) to reduce repeated fetches.
- If you use tool profiles/allowlists, add `web_search`/`web_fetch` or `group:web`.
 - If the Brave key is missing, `web_search` returns a short setup hint with a docs link.
