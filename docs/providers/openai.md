---
summary: "Use OpenAI via API keys or Codex subscription in Surprisebot"
read_when:
  - You want to use OpenAI models in Surprisebot
  - You want Codex subscription auth instead of API keys
---
# OpenAI

OpenAI provides developer APIs for GPT models. Codex supports **ChatGPT sign-in** for subscription
access or **API key** sign-in for usage-based access. Codex cloud requires ChatGPT sign-in, while
the Codex CLI supports either sign-in method. The Codex CLI caches login details in
`~/.codex/auth.json` (or your OS credential store), which Surprisebot can reuse.

## Option A: OpenAI API key (OpenAI Platform)

**Best for:** direct API access and usage-based billing.
Get your API key from the OpenAI dashboard.

### CLI setup

```bash
surprisebot onboard --auth-choice openai-api-key
# or non-interactive
surprisebot onboard --openai-api-key "$OPENAI_API_KEY"
```

### Config snippet

```json5
{
  env: { OPENAI_API_KEY: "sk-..." },
  agents: { defaults: { model: { primary: "openai/gpt-5.2" } } }
}
```

## Option B: OpenAI Code (Codex) subscription

**Best for:** using ChatGPT/Codex subscription access instead of an API key.
Codex cloud requires ChatGPT sign-in, while the Codex CLI supports ChatGPT or API key sign-in.

Surprisebot can reuse your **Codex CLI** login (`~/.codex/auth.json`) or run the OAuth flow.

### CLI setup

```bash
# Reuse existing Codex CLI login
surprisebot onboard --auth-choice codex-cli

# Or run Codex OAuth in the wizard
surprisebot onboard --auth-choice openai-codex
```

### Config snippet

```json5
{
  agents: { defaults: { model: { primary: "openai-codex/gpt-5.2" } } }
}
```

## Notes

- Model refs always use `provider/model` (see [/concepts/models](/concepts/models)).
- Auth details + reuse rules are in [/concepts/oauth](/concepts/oauth).


## Multi‑seat Codex CLI (advanced)

If you have multiple Codex CLI seats, you can configure **failover** by listing seats
as model fallbacks. This spreads load when a seat is busy or rate‑limited.

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "codex-cli-seat1/gpt-5.2-codex",
        fallbacks: [
          "codex-cli-seat2/gpt-5.2-codex",
          "codex-cli-seat3/gpt-5.2-codex",
          "codex-cli-seat4/gpt-5.2-codex",
          "codex-cli-seat5/gpt-5.2-codex"
        ]
      }
    }
  }
}
```

Notes:
- This is **failover**, not round‑robin.
- Each seat needs a valid `auth.json` in its seat directory.
- See [Deploy checklist](/start/surprisebot-deploy-checklist) for seat layout.

