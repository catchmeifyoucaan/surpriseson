import { resolveTalkApiKey } from "./talk.js";
import type { SurprisebotConfig } from "./types.js";

type WarnState = { warned: boolean };

let defaultWarnState: WarnState = { warned: false };

const DEFAULT_MODEL_ALIASES: Readonly<Record<string, string>> = {
  // Anthropic (pi-ai catalog uses "latest" ids without date suffix)
  opus: "anthropic/claude-opus-4-5",
  sonnet: "anthropic/claude-sonnet-4-5",

  // OpenAI
  gpt: "openai/gpt-5.2",
  "gpt-mini": "openai/gpt-5-mini",

  // Google Gemini (3.x are preview ids in the catalog)
  gemini: "google/gemini-3-pro-preview",
  "gemini-flash": "google/gemini-3-flash-preview",
};

const DEFAULT_IDENTITY = {
  name: "Surprisebot",
  emoji: "🧠⚡",
  theme: "Precision, initiative, evidence, speed.",
};

export type SessionDefaultsOptions = {
  warn?: (message: string) => void;
  warnState?: WarnState;
};

export function applyMessageDefaults(cfg: SurprisebotConfig): SurprisebotConfig {
  const messages = cfg.messages;
  const hasAckScope = messages?.ackReactionScope !== undefined;
  if (hasAckScope) return cfg;

  const nextMessages = messages ? { ...messages } : {};
  nextMessages.ackReactionScope = "group-mentions";
  return {
    ...cfg,
    messages: nextMessages,
  };
}

export function applySessionDefaults(
  cfg: SurprisebotConfig,
  options: SessionDefaultsOptions = {},
): SurprisebotConfig {
  const session = cfg.session;
  if (!session || session.mainKey === undefined) return cfg;

  const trimmed = session.mainKey.trim();
  const warn = options.warn ?? console.warn;
  const warnState = options.warnState ?? defaultWarnState;

  const next: SurprisebotConfig = {
    ...cfg,
    session: { ...session, mainKey: "main" },
  };

  if (trimmed && trimmed !== "main" && !warnState.warned) {
    warnState.warned = true;
    warn('session.mainKey is ignored; main session is always "main".');
  }

  return next;
}

export function applyTalkApiKey(config: SurprisebotConfig): SurprisebotConfig {
  const resolved = resolveTalkApiKey();
  if (!resolved) return config;
  const existing = config.talk?.apiKey?.trim();
  if (existing) return config;
  return {
    ...config,
    talk: {
      ...config.talk,
      apiKey: resolved,
    },
  };
}

export function applyModelDefaults(cfg: SurprisebotConfig): SurprisebotConfig {
  const existingAgent = cfg.agents?.defaults;
  if (!existingAgent) return cfg;
  const existingModels = existingAgent.models ?? {};
  if (Object.keys(existingModels).length === 0) return cfg;

  let mutated = false;
  const nextModels: Record<string, { alias?: string }> = {
    ...existingModels,
  };

  for (const [alias, target] of Object.entries(DEFAULT_MODEL_ALIASES)) {
    const entry = nextModels[target];
    if (!entry) continue;
    if (entry.alias !== undefined) continue;
    nextModels[target] = { ...entry, alias };
    mutated = true;
  }

  if (!mutated) return cfg;

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: { ...existingAgent, models: nextModels },
    },
  };
}

export function applyIdentityDefaults(cfg: SurprisebotConfig): SurprisebotConfig {
  const defaults = cfg.agents?.defaults;
  if (!defaults) return cfg;

  const existing = defaults.identity ?? {};
  const name = existing.name?.trim();
  const emoji = existing.emoji?.trim();
  const theme = existing.theme?.trim();

  if (name && emoji && theme) return cfg;

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...defaults,
        identity: {
          ...DEFAULT_IDENTITY,
          ...existing,
          name: name || DEFAULT_IDENTITY.name,
          emoji: emoji || DEFAULT_IDENTITY.emoji,
          theme: theme || DEFAULT_IDENTITY.theme,
        },
      },
    },
  };
}

export function applyLoggingDefaults(cfg: SurprisebotConfig): SurprisebotConfig {
  const logging = cfg.logging;
  if (!logging) return cfg;
  if (logging.redactSensitive) return cfg;
  return {
    ...cfg,
    logging: {
      ...logging,
      redactSensitive: "tools",
    },
  };
}

export function applyContextPruningDefaults(cfg: SurprisebotConfig): SurprisebotConfig {
  const defaults = cfg.agents?.defaults;
  if (!defaults) return cfg;
  const contextPruning = defaults?.contextPruning;
  if (contextPruning?.mode) return cfg;

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...defaults,
        contextPruning: {
          ...contextPruning,
          mode: "adaptive",
        },
      },
    },
  };
}


export function applyMissionControlDefaults(cfg: SurprisebotConfig): SurprisebotConfig {
  const mc = cfg.missionControl ?? {};
  const alerts = mc.alerts ?? {};
  const trust = mc.trust ?? {};
  const qa = mc.qa ?? {};

  let mutated = false;

  const nextAlerts = { ...alerts };
  if (nextAlerts.minEvidenceCount === undefined) {
    nextAlerts.minEvidenceCount = 2;
    mutated = true;
  }
  if (nextAlerts.suppressIfMissingEvidence === undefined) {
    nextAlerts.suppressIfMissingEvidence = true;
    mutated = true;
  }

  const nextTrust = { ...trust };
  if (!nextTrust.defaultTier) {
    nextTrust.defaultTier = "unverified";
    mutated = true;
  }
  const bySource = { ...(nextTrust.bySource ?? {}) };
  if (!bySource["artemis-stanford"]) {
    bySource["artemis-stanford"] = "quarantine";
    mutated = true;
  }
  if (!bySource["artemis-cert"]) {
    bySource["artemis-cert"] = "quarantine";
    mutated = true;
  }
  if (Object.keys(bySource).length > 0) {
    nextTrust.bySource = bySource;
  }

  const nextQa = { ...qa };
  if (!nextQa.agentId) {
    nextQa.agentId = "surprisebot-qa";
    mutated = true;
  }
  if (!nextQa.requiredSeverities || nextQa.requiredSeverities.length === 0) {
    nextQa.requiredSeverities = ["high"];
    mutated = true;
  }
  if (!nextQa.requiredTrustTiers || nextQa.requiredTrustTiers.length === 0) {
    nextQa.requiredTrustTiers = ["quarantine"];
    mutated = true;
  }

  if (!mutated) return cfg;

  return {
    ...cfg,
    missionControl: {
      ...mc,
      alerts: nextAlerts,
      trust: nextTrust,
      qa: nextQa,
    },
  };
}

export function resetSessionDefaultsWarningForTests() {
  defaultWarnState = { warned: false };
}
