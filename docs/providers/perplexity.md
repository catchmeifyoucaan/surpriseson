---
summary: "Use Perplexity's Sonar models with Surprisebot"
read_when:
  - You want Perplexity (Sonar) models in Surprisebot
  - You need to configure the Perplexity provider
---
# Perplexity

Perplexity exposes **Sonar** models behind an OpenAI‑compatible API. Surprisebot can
route to these models by setting the provider to `perplexity` and supplying a
`PPLX_API_KEY`.

## CLI setup

```bash
surprisebot onboard --auth-choice apiKey --token-provider perplexity --token "$PPLX_API_KEY"
```

## Config snippet

```json5
{
  env: { PPLX_API_KEY: "pplx-..." },
  agents: {
    defaults: {
      model: { primary: "perplexity/sonar-pro" }
    }
  },
  models: {
    providers: {
      perplexity: {
        api: "openai-completions",
        // baseUrl is optional when using defaults
        // baseUrl: "https://api.perplexity.ai"
      }
    }
  }
}
```

## Notes

- Model refs are `perplexity/<model>` (example: `perplexity/sonar-pro`).
- Perplexity uses **OpenAI‑compatible** request/response shapes.
- For advanced provider config, see [Model providers](/concepts/model-providers).
