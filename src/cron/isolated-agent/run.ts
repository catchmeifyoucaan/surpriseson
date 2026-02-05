import {
  resolveAgentConfig,
  resolveAgentModelFallbacksOverride,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import { runCliAgent } from "../../agents/cli-runner.js";
import { getCliSessionId, setCliSessionId } from "../../agents/cli-session.js";
import { lookupContextTokens } from "../../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS, DEFAULT_MODEL, DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { loadModelCatalog } from "../../agents/model-catalog.js";
import { runWithModelFallback } from "../../agents/model-fallback.js";
import {
  getModelRefStatus,
  isCliProvider,
  resolveAllowedModelRef,
  resolveConfiguredModelRef,
  resolveHooksGmailModel,
  resolveThinkingDefault,
} from "../../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import { buildWorkspaceSkillSnapshot } from "../../agents/skills.js";
import { resolveAgentTimeoutMs } from "../../agents/timeout.js";
import { hasNonzeroUsage } from "../../agents/usage.js";
import { ensureAgentWorkspace } from "../../agents/workspace.js";
import { ensureSharedMemoryForWorkspace } from "../../agents/shared-memory.js";
import {
  formatXHighModelHint,
  normalizeThinkLevel,
  supportsXHighThinking,
} from "../../auto-reply/thinking.js";
import type { CliDeps } from "../../cli/deps.js";
import type { SurprisebotConfig } from "../../config/config.js";
import { resolveSessionTranscriptPath, saveSessionStore } from "../../config/sessions.js";
import type { AgentDefaultsConfig } from "../../config/types.js";
import { registerAgentRunContext } from "../../infra/agent-events.js";
import { evaluateBudget, resolveBudgetCaps } from "../../infra/budget-manager.js";
import { registerJobContext, clearJobContext } from "../../infra/job-context.js";
import { appendMissionControlRecord } from "../../infra/mission-control/ledger.js";
import { deliverOutboundPayloads } from "../../infra/outbound/deliver.js";
import type { ReplyPayload } from "../../auto-reply/types.js";
import { buildAgentMainSessionKey, normalizeAgentId } from "../../routing/session-key.js";
import type { CronJob } from "../types.js";
import { resolveDeliveryTarget } from "./delivery-target.js";
import {
  isHeartbeatOnlyResponse,
  pickSummaryFromOutput,
  pickSummaryFromPayloads,
  resolveHeartbeatAckMaxChars,
} from "./helpers.js";
import { resolveCronSession } from "./session.js";

export type RunCronAgentTurnResult = {
  status: "ok" | "error" | "skipped";
  summary?: string;
  error?: string;
};

export async function runCronIsolatedAgentTurn(params: {
  cfg: SurprisebotConfig;
  deps: CliDeps;
  job: CronJob;
  message: string;
  sessionKey: string;
  agentId?: string;
  lane?: string;
}): Promise<RunCronAgentTurnResult> {
  const defaultAgentId = resolveDefaultAgentId(params.cfg);
  const requestedAgentId =
    typeof params.agentId === "string" && params.agentId.trim()
      ? params.agentId
      : typeof params.job.agentId === "string" && params.job.agentId.trim()
        ? params.job.agentId
        : undefined;
  const normalizedRequested = requestedAgentId ? normalizeAgentId(requestedAgentId) : undefined;
  const agentConfigOverride = normalizedRequested
    ? resolveAgentConfig(params.cfg, normalizedRequested)
    : undefined;
  const { model: overrideModel, ...agentOverrideRest } = agentConfigOverride ?? {};
  const agentId = agentConfigOverride ? (normalizedRequested ?? defaultAgentId) : defaultAgentId;
  const agentCfg: AgentDefaultsConfig = Object.assign(
    {},
    params.cfg.agents?.defaults,
    agentOverrideRest as Partial<AgentDefaultsConfig>,
  );
  if (typeof overrideModel === "string") {
    agentCfg.model = { primary: overrideModel };
  } else if (overrideModel) {
    agentCfg.model = overrideModel;
  }
  const cfgWithAgentDefaults: SurprisebotConfig = {
    ...params.cfg,
    agents: Object.assign({}, params.cfg.agents, { defaults: agentCfg }),
  };

  const baseSessionKey = (params.sessionKey?.trim() || `cron:${params.job.id}`).trim();
  const agentSessionKey = buildAgentMainSessionKey({
    agentId,
    mainKey: baseSessionKey,
  });

  const jobType = (params.job.jobType?.trim() || params.job.id).trim();
  const budgetDecision = await evaluateBudget({
    cfg: cfgWithAgentDefaults,
    agentId,
    jobType,
  });
  if (budgetDecision.decision === "deny" || budgetDecision.decision === "defer") {
    return {
      status: "skipped",
      summary: `Budget ${budgetDecision.decision}: ${budgetDecision.reason}`.trim(),
    };
  }

  const workspaceDirRaw = resolveAgentWorkspaceDir(params.cfg, agentId);
  const workspace = await ensureAgentWorkspace({
    dir: workspaceDirRaw,
    ensureBootstrapFiles: !agentCfg?.skipBootstrap,
  });
  const workspaceDir = workspace.dir;
  try {
    await ensureSharedMemoryForWorkspace({
      cfg: params.cfg,
      agentId,
      workspaceDir,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`Shared memory init failed: ${message}`);
  }

  const resolvedDefault = resolveConfiguredModelRef({
    cfg: cfgWithAgentDefaults,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });
  let provider = resolvedDefault.provider;
  let model = resolvedDefault.model;
  let catalog: Awaited<ReturnType<typeof loadModelCatalog>> | undefined;
  const loadCatalog = async () => {
    if (!catalog) {
      catalog = await loadModelCatalog({ config: cfgWithAgentDefaults });
    }
    return catalog;
  };
  // Resolve model - prefer hooks.gmail.model for Gmail hooks.
  const isGmailHook = baseSessionKey.startsWith("hook:gmail:");
  const hooksGmailModelRef = isGmailHook
    ? resolveHooksGmailModel({
        cfg: params.cfg,
        defaultProvider: DEFAULT_PROVIDER,
      })
    : null;
  if (hooksGmailModelRef) {
    const status = getModelRefStatus({
      cfg: params.cfg,
      catalog: await loadCatalog(),
      ref: hooksGmailModelRef,
      defaultProvider: resolvedDefault.provider,
      defaultModel: resolvedDefault.model,
    });
    if (status.allowed) {
      provider = hooksGmailModelRef.provider;
      model = hooksGmailModelRef.model;
    }
  }
  const modelOverrideRaw =
    params.job.payload.kind === "agentTurn" ? params.job.payload.model : undefined;
  if (modelOverrideRaw !== undefined) {
    if (typeof modelOverrideRaw !== "string") {
      return { status: "error", error: "invalid model: expected string" };
    }
    const resolvedOverride = resolveAllowedModelRef({
      cfg: cfgWithAgentDefaults,
      catalog: await loadCatalog(),
      raw: modelOverrideRaw,
      defaultProvider: resolvedDefault.provider,
      defaultModel: resolvedDefault.model,
    });
    if ("error" in resolvedOverride) {
      return { status: "error", error: resolvedOverride.error };
    }
    provider = resolvedOverride.ref.provider;
    model = resolvedOverride.ref.model;
  }
  const now = Date.now();
  const cronSession = resolveCronSession({
    cfg: params.cfg,
    sessionKey: agentSessionKey,
    agentId,
    nowMs: now,
  });

  registerJobContext({
    sessionKey: agentSessionKey,
    jobType,
    runId: cronSession.sessionEntry.sessionId,
  });

  const budgetCaps = resolveBudgetCaps({
    cfg: cfgWithAgentDefaults,
    agentId,
    jobType,
  });

  const runStartedAt = new Date().toISOString();
  const runLedgerId = `run-${cronSession.sessionEntry.sessionId}`;
  let runOutcome: "done" | "failed" | "cancelled" = "done";
  let runError: string | null = null;

  try {
    await appendMissionControlRecord({
      cfg: cfgWithAgentDefaults,
      kind: "run-ledger",
      record: {
        id: runLedgerId,
        ts: runStartedAt,
        source: "cron",
        version: 1,
        agentId,
        status: "running",
        command: `cron:${params.job.id}`,
        startedAt: runStartedAt,
        jobType,
        meta: {
          jobId: params.job.id,
          sessionKey: agentSessionKey,
        },
      },
    }).catch(() => {});

    // Resolve thinking level - job thinking > hooks.gmail.thinking > agent default
  const hooksGmailThinking = isGmailHook
    ? normalizeThinkLevel(params.cfg.hooks?.gmail?.thinking)
    : undefined;
  const thinkOverride = normalizeThinkLevel(agentCfg?.thinkingDefault);
  const jobThink = normalizeThinkLevel(
    (params.job.payload.kind === "agentTurn" ? params.job.payload.thinking : undefined) ??
      undefined,
  );
  let thinkLevel = jobThink ?? hooksGmailThinking ?? thinkOverride;
  if (!thinkLevel) {
    thinkLevel = resolveThinkingDefault({
      cfg: cfgWithAgentDefaults,
      provider,
      model,
      catalog: await loadCatalog(),
    });
  }
  if (thinkLevel === "xhigh" && !supportsXHighThinking(provider, model)) {
    thinkLevel = "high";
  }

  const timeoutMs = resolveAgentTimeoutMs({
    cfg: cfgWithAgentDefaults,
    overrideSeconds:
      params.job.payload.kind === "agentTurn" ? params.job.payload.timeoutSeconds : undefined,
  });
  const effectiveTimeoutMs = budgetCaps.maxRuntimeSeconds
    ? Math.min(timeoutMs, budgetCaps.maxRuntimeSeconds * 1000)
    : timeoutMs;

  const delivery = params.job.payload.kind === "agentTurn" && params.job.payload.deliver === true;
  const bestEffortDeliver =
    params.job.payload.kind === "agentTurn" && params.job.payload.bestEffortDeliver === true;

  const resolvedDelivery = await resolveDeliveryTarget(cfgWithAgentDefaults, agentId, {
    channel:
      params.job.payload.kind === "agentTurn" ? (params.job.payload.channel ?? "last") : "last",
    to: params.job.payload.kind === "agentTurn" ? params.job.payload.to : undefined,
  });

  const base = `[cron:${params.job.id} ${params.job.name}] ${params.message}`.trim();
  const commandBody = base;

  const needsSkillsSnapshot = cronSession.isNewSession || !cronSession.sessionEntry.skillsSnapshot;
  const skillsSnapshot = needsSkillsSnapshot
    ? buildWorkspaceSkillSnapshot(workspaceDir, {
        config: cfgWithAgentDefaults,
      })
    : cronSession.sessionEntry.skillsSnapshot;
  if (needsSkillsSnapshot && skillsSnapshot) {
    cronSession.sessionEntry = {
      ...cronSession.sessionEntry,
      updatedAt: Date.now(),
      skillsSnapshot,
    };
    cronSession.store[agentSessionKey] = cronSession.sessionEntry;
    await saveSessionStore(cronSession.storePath, cronSession.store);
  }

  // Persist systemSent before the run, mirroring the inbound auto-reply behavior.
  cronSession.sessionEntry.systemSent = true;
  cronSession.store[agentSessionKey] = cronSession.sessionEntry;
  await saveSessionStore(cronSession.storePath, cronSession.store);

  let runResult: Awaited<ReturnType<typeof runEmbeddedPiAgent>>;
  let fallbackProvider = provider;
  let fallbackModel = model;
  try {
    const sessionFile = resolveSessionTranscriptPath(cronSession.sessionEntry.sessionId, agentId);
    const resolvedVerboseLevel =
      (cronSession.sessionEntry.verboseLevel as "on" | "off" | undefined) ??
      (agentCfg?.verboseDefault as "on" | "off" | undefined);
    registerAgentRunContext(cronSession.sessionEntry.sessionId, {
      sessionKey: agentSessionKey,
      verboseLevel: resolvedVerboseLevel,
    });
    const messageChannel = resolvedDelivery.channel;
    const fallbackResult = await runWithModelFallback({
      cfg: cfgWithAgentDefaults,
      provider,
      model,
      fallbacksOverride: resolveAgentModelFallbacksOverride(params.cfg, agentId),
      run: (providerOverride, modelOverride) => {
        if (isCliProvider(providerOverride, cfgWithAgentDefaults)) {
          const cliSessionId = getCliSessionId(cronSession.sessionEntry, providerOverride);
          return runCliAgent({
            sessionId: cronSession.sessionEntry.sessionId,
            sessionKey: agentSessionKey,
            sessionFile,
            workspaceDir,
            config: cfgWithAgentDefaults,
            prompt: commandBody,
            provider: providerOverride,
            model: modelOverride,
            thinkLevel,
            timeoutMs: effectiveTimeoutMs,
            runId: cronSession.sessionEntry.sessionId,
            cliSessionId,
          });
        }
        return runEmbeddedPiAgent({
          sessionId: cronSession.sessionEntry.sessionId,
          sessionKey: agentSessionKey,
          messageChannel,
          sessionFile,
          workspaceDir,
          config: cfgWithAgentDefaults,
          skillsSnapshot,
          prompt: commandBody,
          lane: params.lane ?? "cron",
          provider: providerOverride,
          model: modelOverride,
          thinkLevel,
          verboseLevel: resolvedVerboseLevel,
          timeoutMs: effectiveTimeoutMs,
          runId: cronSession.sessionEntry.sessionId,
        });
      },
    });
    runResult = fallbackResult.result;
    fallbackProvider = fallbackResult.provider;
    fallbackModel = fallbackResult.model;
  } catch (err) {
    runOutcome = "failed";
    runError = String(err);
    return { status: "error", error: String(err) };
  }

  const payloads = applyOutputBudget(runResult.payloads ?? [], budgetCaps.maxOutputChars);

  // Update token+model fields in the session store.
  {
    const usage = runResult.meta.agentMeta?.usage;
    const modelUsed = runResult.meta.agentMeta?.model ?? fallbackModel ?? model;
    const providerUsed = runResult.meta.agentMeta?.provider ?? fallbackProvider ?? provider;
    const contextTokens =
      agentCfg?.contextTokens ?? lookupContextTokens(modelUsed) ?? DEFAULT_CONTEXT_TOKENS;

    cronSession.sessionEntry.modelProvider = providerUsed;
    cronSession.sessionEntry.model = modelUsed;
    cronSession.sessionEntry.contextTokens = contextTokens;
    if (isCliProvider(providerUsed, cfgWithAgentDefaults)) {
      const cliSessionId = runResult.meta.agentMeta?.sessionId?.trim();
      if (cliSessionId) {
        setCliSessionId(cronSession.sessionEntry, providerUsed, cliSessionId);
      }
    }
    if (hasNonzeroUsage(usage)) {
      const input = usage.input ?? 0;
      const output = usage.output ?? 0;
      const promptTokens = input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      cronSession.sessionEntry.inputTokens = input;
      cronSession.sessionEntry.outputTokens = output;
      cronSession.sessionEntry.totalTokens =
        promptTokens > 0 ? promptTokens : (usage.total ?? input);
    }
    cronSession.store[agentSessionKey] = cronSession.sessionEntry;
    await saveSessionStore(cronSession.storePath, cronSession.store);
  }
  const firstText = payloads[0]?.text ?? "";
  const summaryRaw = pickSummaryFromPayloads(payloads) ?? pickSummaryFromOutput(firstText) ?? "";
  const summary = budgetCaps.maxOutputChars
    ? clampText(summaryRaw, budgetCaps.maxOutputChars)
    : summaryRaw;

  // Skip delivery for heartbeat-only responses (HEARTBEAT_OK with no real content).
  const ackMaxChars = resolveHeartbeatAckMaxChars(agentCfg);
  const skipHeartbeatDelivery = delivery && isHeartbeatOnlyResponse(payloads, ackMaxChars);

  if (delivery && !skipHeartbeatDelivery) {
    if (!resolvedDelivery.to) {
      const reason =
        resolvedDelivery.error?.message ?? "Cron delivery requires a recipient (--to).";
      if (!bestEffortDeliver) {
        runOutcome = "failed";
        runError = reason;
        return {
          status: "error",
          summary,
          error: reason,
        };
      }
      runOutcome = "cancelled";
      return {
        status: "skipped",
        summary: `Delivery skipped (${reason}).`,
      };
    }
    try {
      await deliverOutboundPayloads({
        cfg: cfgWithAgentDefaults,
        channel: resolvedDelivery.channel,
        to: resolvedDelivery.to,
        accountId: resolvedDelivery.accountId,
        payloads,
        bestEffort: bestEffortDeliver,
        deps: {
          sendWhatsApp: params.deps.sendMessageWhatsApp,
          sendTelegram: params.deps.sendMessageTelegram,
          sendDiscord: params.deps.sendMessageDiscord,
          sendSlack: params.deps.sendMessageSlack,
          sendSignal: params.deps.sendMessageSignal,
          sendIMessage: params.deps.sendMessageIMessage,
          sendMSTeams: params.deps.sendMessageMSTeams
            ? async (to, text, opts) =>
                await params.deps.sendMessageMSTeams({
                  cfg: params.cfg,
                  to,
                  text,
                  mediaUrl: opts?.mediaUrl,
                })
            : undefined,
        },
      });
    } catch (err) {
      if (!bestEffortDeliver) {
        runOutcome = "failed";
        runError = String(err);
        return { status: "error", summary, error: String(err) };
      }
      return { status: "ok", summary };
    }
  }

  return { status: "ok", summary };

  } finally {
    await appendMissionControlRecord({
      cfg: cfgWithAgentDefaults,
      kind: "run-ledger",
      record: {
        id: runLedgerId,
        ts: new Date().toISOString(),
        source: "cron",
        version: 1,
        agentId,
        status: runOutcome,
        command: `cron:${params.job.id}`,
        startedAt: runStartedAt,
        finishedAt: new Date().toISOString(),
        exitCode: runOutcome === "failed" ? 1 : 0,
        jobType,
        meta: {
          jobId: params.job.id,
          sessionKey: agentSessionKey,
          error: runError ?? undefined,
        },
      },
    }).catch(() => {});
    clearJobContext(agentSessionKey);
  }
}
function clampText(text: string, maxChars?: number): string {
  if (!maxChars || maxChars <= 0) return text;
  if (text.length <= maxChars) return text;
  const trimmed = text.slice(0, Math.max(0, maxChars - 3)).trimEnd();
  return `${trimmed}...`;
}

function applyOutputBudget(payloads: ReplyPayload[], maxChars?: number): ReplyPayload[] {
  if (!maxChars || maxChars <= 0) return payloads;
  return payloads.map((payload) => {
    if (!payload.text) return payload;
    return { ...payload, text: clampText(payload.text, maxChars) };
  });
}

