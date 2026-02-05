import crypto from "node:crypto";
import { setCliSessionId } from "../../agents/cli-session.js";
import { lookupContextTokens } from "../../agents/context.js";
import { DEFAULT_CONTEXT_TOKENS } from "../../agents/defaults.js";
import { resolveModelAuthMode } from "../../agents/model-auth.js";
import { isCliProvider } from "../../agents/model-selection.js";
import { queueEmbeddedPiMessage } from "../../agents/pi-embedded.js";
import { hasNonzeroUsage } from "../../agents/usage.js";
import {
  resolveAgentIdFromSessionKey,
  resolveSessionTranscriptPath,
  type SessionEntry,
  saveSessionStore,
  updateSessionStoreEntry,
} from "../../config/sessions.js";
import type { TypingMode } from "../../config/types.js";
import { logVerbose } from "../../globals.js";
import { defaultRuntime } from "../../runtime.js";
import { resolveModelCostConfig } from "../../utils/usage-format.js";
import type { OriginatingChannelType, TemplateContext } from "../templating.js";
import type { VerboseLevel } from "../thinking.js";
import type { GetReplyOptions, ReplyPayload } from "../types.js";
import { runAgentTurnWithFallback } from "./agent-runner-execution.js";
import {
  createShouldEmitToolResult,
  finalizeWithFollowup,
  isAudioPayload,
  signalTypingIfNeeded,
} from "./agent-runner-helpers.js";
import { runMemoryCaptureIfNeeded, runMemoryFlushIfNeeded } from "./agent-runner-memory.js";
import { buildReplyPayloads } from "./agent-runner-payloads.js";
import { appendUsageLine, formatResponseUsageLine } from "./agent-runner-utils.js";
import { createAudioAsVoiceBuffer, createBlockReplyPipeline } from "./block-reply-pipeline.js";
import { resolveBlockStreamingCoalescing } from "./block-streaming.js";
import { createFollowupRunner } from "./followup-runner.js";
import { enqueueFollowupRun, type FollowupRun, type QueueSettings } from "./queue.js";
import { createReplyToModeFilterForChannel, resolveReplyToMode } from "./reply-threading.js";
import { incrementCompactionCount } from "./session-updates.js";
import type { TypingController } from "./typing.js";
import { createTypingSignaler } from "./typing-mode.js";

const BLOCK_REPLY_SEND_TIMEOUT_MS = 15_000;
const TOOL_QUERY_RE =
  /\b(ls|list|show|read|cat|grep|find|search|locate|tail|head|stat|du|df|ps|top|journalctl|systemctl|service|log|folder|directory|file|path|contents?)\b/i;
const TOOL_CLAIM_RE =
  /\btool call\b|\btool result\b|\btool results?\b|\btool result for id\b/i;
const TOOL_WAIT_CLAIM_RE =
  /\b(waiting|still waiting)\b.*\b(output|result|command|process|ls|exec|ps|find|cat|grep)\b/i;
const TOOL_EXEC_CLAIM_RE =
  /\b(I|I've|I am|I'm)\s+(ran|run|running|executed|executing|started)\b.*\b(command|process|ls|exec|ps|find|cat|grep|head|tail)\b/i;

type PendingToolResult = {
  id: string;
  name: string;
  meta?: string;
  startedAt?: number;
  timedOut?: boolean;
};

function shouldRequireToolForQuery(text: string): boolean {
  return TOOL_QUERY_RE.test(text);
}

function formatMissingToolResults(pending: PendingToolResult[]): string {
  const lines = [
    "⚠️ Tool results missing. Reply blocked to avoid unverified output.",
    ...pending.slice(0, 5).map((entry) => {
      const meta = entry.meta ? ` ${entry.meta}` : "";
      const timedOut = entry.timedOut ? " (timed out)" : "";
      return `- ${entry.name} (${entry.id}${meta})${timedOut}`;
    }),
  ];
  if (pending.length > 5) lines.push(`… +${pending.length - 5} more`);
  lines.push("Retry the command or run it directly with /bash run …");
  return lines.join("\n");
}

export async function runReplyAgent(params: {
  commandBody: string;
  followupRun: FollowupRun;
  queueKey: string;
  resolvedQueue: QueueSettings;
  shouldSteer: boolean;
  shouldFollowup: boolean;
  isActive: boolean;
  isStreaming: boolean;
  opts?: GetReplyOptions;
  typing: TypingController;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  defaultModel: string;
  agentCfgContextTokens?: number;
  resolvedVerboseLevel: VerboseLevel;
  isNewSession: boolean;
  blockStreamingEnabled: boolean;
  blockReplyChunking?: {
    minChars: number;
    maxChars: number;
    breakPreference: "paragraph" | "newline" | "sentence";
  };
  resolvedBlockStreamingBreak: "text_end" | "message_end";
  sessionCtx: TemplateContext;
  shouldInjectGroupIntro: boolean;
  typingMode: TypingMode;
}): Promise<ReplyPayload | ReplyPayload[] | undefined> {
  const {
    commandBody,
    followupRun,
    queueKey,
    resolvedQueue,
    shouldSteer,
    shouldFollowup,
    isActive,
    isStreaming,
    opts,
    typing,
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    defaultModel,
    agentCfgContextTokens,
    resolvedVerboseLevel,
    isNewSession,
    blockStreamingEnabled,
    blockReplyChunking,
    resolvedBlockStreamingBreak,
    sessionCtx,
    shouldInjectGroupIntro,
    typingMode,
  } = params;

  let activeSessionEntry = sessionEntry;
  const activeSessionStore = sessionStore;
  let activeIsNewSession = isNewSession;

  const isHeartbeat = opts?.isHeartbeat === true;
  const typingSignals = createTypingSignaler({
    typing,
    mode: typingMode,
    isHeartbeat,
  });

  const shouldEmitToolResult = createShouldEmitToolResult({
    sessionKey,
    storePath,
    resolvedVerboseLevel,
  });

  const pendingToolTasks = new Set<Promise<void>>();
  const blockReplyTimeoutMs = opts?.blockReplyTimeoutMs ?? BLOCK_REPLY_SEND_TIMEOUT_MS;

  const replyToChannel =
    sessionCtx.OriginatingChannel ??
    ((sessionCtx.Surface ?? sessionCtx.Provider)?.toLowerCase() as
      | OriginatingChannelType
      | undefined);
  const replyToMode = resolveReplyToMode(
    followupRun.run.config,
    replyToChannel,
    sessionCtx.AccountId,
  );
  const applyReplyToMode = createReplyToModeFilterForChannel(replyToMode, replyToChannel);
  const cfg = followupRun.run.config;
  const strictToolResults = cfg.tools?.toolResults?.strict === true;
  const effectiveBlockStreamingEnabled = strictToolResults ? false : blockStreamingEnabled;
  const blockReplyCoalescing =
    effectiveBlockStreamingEnabled && opts?.onBlockReply
      ? resolveBlockStreamingCoalescing(
          cfg,
          sessionCtx.Provider,
          sessionCtx.AccountId,
          blockReplyChunking,
        )
      : undefined;
  const blockReplyPipeline =
    effectiveBlockStreamingEnabled && opts?.onBlockReply
      ? createBlockReplyPipeline({
          onBlockReply: opts.onBlockReply,
          timeoutMs: blockReplyTimeoutMs,
          coalescing: blockReplyCoalescing,
          buffer: createAudioAsVoiceBuffer({ isAudioPayload }),
        })
      : null;

  if (shouldSteer && isStreaming) {
    const steered = queueEmbeddedPiMessage(followupRun.run.sessionId, followupRun.prompt);
    if (steered && !shouldFollowup) {
      if (activeSessionEntry && activeSessionStore && sessionKey) {
        activeSessionEntry.updatedAt = Date.now();
        activeSessionStore[sessionKey] = activeSessionEntry;
        if (storePath) {
          await saveSessionStore(storePath, activeSessionStore);
        }
      }
      typing.cleanup();
      return undefined;
    }
  }

  if (isActive && (shouldFollowup || resolvedQueue.mode === "steer")) {
    enqueueFollowupRun(queueKey, followupRun, resolvedQueue);
    if (activeSessionEntry && activeSessionStore && sessionKey) {
      activeSessionEntry.updatedAt = Date.now();
      activeSessionStore[sessionKey] = activeSessionEntry;
      if (storePath) {
        await saveSessionStore(storePath, activeSessionStore);
      }
    }
    typing.cleanup();
    return undefined;
  }

  activeSessionEntry = await runMemoryFlushIfNeeded({
    cfg,
    followupRun,
    sessionCtx,
    opts,
    defaultModel,
    agentCfgContextTokens,
    resolvedVerboseLevel,
    sessionEntry: activeSessionEntry,
    sessionStore: activeSessionStore,
    sessionKey,
    storePath,
    isHeartbeat,
  });

  activeSessionEntry = await runMemoryCaptureIfNeeded({
    cfg,
    followupRun,
    sessionCtx,
    opts,
    defaultModel,
    agentCfgContextTokens,
    resolvedVerboseLevel,
    sessionEntry: activeSessionEntry,
    sessionStore: activeSessionStore,
    sessionKey,
    storePath,
    isHeartbeat,
  });

  const runFollowupTurn = createFollowupRunner({
    opts,
    typing,
    typingMode,
    sessionEntry: activeSessionEntry,
    sessionStore: activeSessionStore,
    sessionKey,
    storePath,
    defaultModel,
    agentCfgContextTokens,
  });

  let responseUsageLine: string | undefined;
  const resetSessionAfterCompactionFailure = async (reason: string): Promise<boolean> => {
    if (!sessionKey || !activeSessionStore || !storePath) return false;
    const nextSessionId = crypto.randomUUID();
    const nextEntry: SessionEntry = {
      ...(activeSessionStore[sessionKey] ?? activeSessionEntry),
      sessionId: nextSessionId,
      updatedAt: Date.now(),
      systemSent: false,
      abortedLastRun: false,
    };
    const agentId = resolveAgentIdFromSessionKey(sessionKey);
    const nextSessionFile = resolveSessionTranscriptPath(
      nextSessionId,
      agentId,
      sessionCtx.MessageThreadId,
    );
    nextEntry.sessionFile = nextSessionFile;
    activeSessionStore[sessionKey] = nextEntry;
    try {
      await saveSessionStore(storePath, activeSessionStore);
    } catch (err) {
      defaultRuntime.error(
        `Failed to persist session reset after compaction failure (${sessionKey}): ${String(err)}`,
      );
    }
    followupRun.run.sessionId = nextSessionId;
    followupRun.run.sessionFile = nextSessionFile;
    activeSessionEntry = nextEntry;
    activeIsNewSession = true;
    defaultRuntime.error(
      `Auto-compaction failed (${reason}). Restarting session ${sessionKey} -> ${nextSessionId} and retrying.`,
    );
    return true;
  };
  try {
    const toolPolicy = cfg.tools?.toolResults;
    let effectiveCommandBody = commandBody;
    let retriedMissingToolResults = false;
    let retriedToollessQuery = false;
    let retriedClaimedTool = false;
    let runOutcome = await runAgentTurnWithFallback({
      commandBody: effectiveCommandBody,
      followupRun,
      sessionCtx,
      opts,
      typingSignals,
      blockReplyPipeline,
      blockStreamingEnabled: effectiveBlockStreamingEnabled,
      blockReplyChunking,
      resolvedBlockStreamingBreak,
      applyReplyToMode,
      shouldEmitToolResult,
      pendingToolTasks,
      resetSessionAfterCompactionFailure,
      isHeartbeat,
      sessionKey,
      getActiveSessionEntry: () => activeSessionEntry,
      activeSessionStore,
      storePath,
      resolvedVerboseLevel,
    });
    while (toolPolicy?.retryOnce === true && runOutcome.kind === "success") {
      const pendingToolResults =
        (runOutcome.runResult.meta.toolResults?.pending?.length ?? 0) > 0;
      if (pendingToolResults && !retriedMissingToolResults) {
        retriedMissingToolResults = true;
        effectiveCommandBody = [
          commandBody,
          "Previous tool calls returned no results. Re-run any required tools and only respond after tool results complete.",
        ].join("\n\n");
        runOutcome = await runAgentTurnWithFallback({
          commandBody: effectiveCommandBody,
          followupRun,
          sessionCtx,
          opts,
          typingSignals,
          blockReplyPipeline,
          blockStreamingEnabled: effectiveBlockStreamingEnabled,
          blockReplyChunking,
          resolvedBlockStreamingBreak,
          applyReplyToMode,
          shouldEmitToolResult,
          pendingToolTasks,
          resetSessionAfterCompactionFailure,
          isHeartbeat,
          sessionKey,
          getActiveSessionEntry: () => activeSessionEntry,
          activeSessionStore,
          storePath,
          resolvedVerboseLevel,
        });
        continue;
      }
      const replyText = (runOutcome.runResult.payloads ?? [])
        .map((payload) => payload.text)
        .filter((text): text is string => Boolean(text && text.trim()))
        .join("\n");
      const startedToolCount = runOutcome.runResult.meta.toolResults?.started ?? 0;
      if (
        toolPolicy?.warnOnMissing === true &&
        startedToolCount === 0 &&
        replyText &&
        (TOOL_CLAIM_RE.test(replyText) ||
          TOOL_WAIT_CLAIM_RE.test(replyText) ||
          TOOL_EXEC_CLAIM_RE.test(replyText)) &&
        !retriedClaimedTool
      ) {
        retriedClaimedTool = true;
        effectiveCommandBody = [
          commandBody,
          "Do not claim tool usage unless a tool actually ran. If no tool is needed, answer directly.",
          "If a tool is needed, run it now and wait for the result before replying.",
        ].join("\n\n");
        runOutcome = await runAgentTurnWithFallback({
          commandBody: effectiveCommandBody,
          followupRun,
          sessionCtx,
          opts,
          typingSignals,
          blockReplyPipeline,
          blockStreamingEnabled: effectiveBlockStreamingEnabled,
          blockReplyChunking,
          resolvedBlockStreamingBreak,
          applyReplyToMode,
          shouldEmitToolResult,
          pendingToolTasks,
          resetSessionAfterCompactionFailure,
          isHeartbeat,
          sessionKey,
          getActiveSessionEntry: () => activeSessionEntry,
          activeSessionStore,
          storePath,
          resolvedVerboseLevel,
        });
        continue;
      }
      const shouldRequireTool =
        toolPolicy?.requireToolForQueries === true && shouldRequireToolForQuery(commandBody);
      if (shouldRequireTool && startedToolCount === 0 && !retriedToollessQuery) {
        retriedToollessQuery = true;
        effectiveCommandBody = [
          commandBody,
          "No tools were run for a filesystem/command query. Run the required tool now (exec/read), then only respond after tool results complete.",
        ].join("\n\n");
        runOutcome = await runAgentTurnWithFallback({
          commandBody: effectiveCommandBody,
          followupRun,
          sessionCtx,
          opts,
          typingSignals,
          blockReplyPipeline,
          blockStreamingEnabled: effectiveBlockStreamingEnabled,
          blockReplyChunking,
          resolvedBlockStreamingBreak,
          applyReplyToMode,
          shouldEmitToolResult,
          pendingToolTasks,
          resetSessionAfterCompactionFailure,
          isHeartbeat,
          sessionKey,
          getActiveSessionEntry: () => activeSessionEntry,
          activeSessionStore,
          storePath,
          resolvedVerboseLevel,
        });
        continue;
      }
      break;
    }

    if (runOutcome.kind === "final") {
      return finalizeWithFollowup(runOutcome.payload, queueKey, runFollowupTurn);
    }

    const { runResult, fallbackProvider, fallbackModel } = runOutcome;
    let { didLogHeartbeatStrip, autoCompactionCompleted } = runOutcome;
    const toolResults = runResult.meta.toolResults;
    const strictToolResults = toolPolicy?.strict === true;
    const requireToolForQueries = toolPolicy?.requireToolForQueries === true;
    const pendingToolResults = (toolResults?.pending ?? []) as PendingToolResult[];
    const replyText = (runResult.payloads ?? [])
      .map((payload) => payload.text)
      .filter((text): text is string => Boolean(text && text.trim()))
      .join("\n");

    if (strictToolResults && pendingToolResults.length > 0) {
      return finalizeWithFollowup(
        {
          text: formatMissingToolResults(pendingToolResults),
          isError: true,
        },
        queueKey,
        runFollowupTurn,
      );
    }

    if (
      requireToolForQueries &&
      (toolResults?.started ?? 0) === 0 &&
      shouldRequireToolForQuery(commandBody)
    ) {
      return finalizeWithFollowup(
        {
          text:
            "⚠️ Tool verification required for filesystem/command queries. " +
            "No tools were run in this reply. Please allow tools or ask me to run the command explicitly.",
          isError: true,
        },
        queueKey,
        runFollowupTurn,
      );
    }

    if (
      !isHeartbeat &&
      toolPolicy?.warnOnMissing === true &&
      (toolResults?.started ?? 0) === 0 &&
      replyText &&
      (TOOL_CLAIM_RE.test(replyText) ||
        TOOL_WAIT_CLAIM_RE.test(replyText) ||
        TOOL_EXEC_CLAIM_RE.test(replyText))
    ) {
      defaultRuntime.error(
        "Reply claimed tool usage but no tool calls were recorded; blocking reply.",
      );
      return finalizeWithFollowup(
        {
          text:
            "⚠️ Reply claimed tool usage, but no tool results were recorded. " +
            "Reply blocked to avoid unverified output.",
          isError: true,
        },
        queueKey,
        runFollowupTurn,
      );
    }

    if (
      shouldInjectGroupIntro &&
      activeSessionEntry &&
      activeSessionStore &&
      sessionKey &&
      activeSessionEntry.groupActivationNeedsSystemIntro
    ) {
      activeSessionEntry.groupActivationNeedsSystemIntro = false;
      activeSessionEntry.updatedAt = Date.now();
      activeSessionStore[sessionKey] = activeSessionEntry;
      if (storePath) {
        await saveSessionStore(storePath, activeSessionStore);
      }
    }

    const payloadArray = runResult.payloads ?? [];

    if (blockReplyPipeline) {
      await blockReplyPipeline.flush({ force: true });
      blockReplyPipeline.stop();
    }
    if (pendingToolTasks.size > 0) {
      await Promise.allSettled(pendingToolTasks);
    }

    // Drain any late tool/block deliveries before deciding there's "nothing to send".
    // Otherwise, a late typing trigger (e.g. from a tool callback) can outlive the run and
    // keep the typing indicator stuck.
    if (payloadArray.length === 0)
      return finalizeWithFollowup(undefined, queueKey, runFollowupTurn);

    const payloadResult = buildReplyPayloads({
      payloads: payloadArray,
      isHeartbeat,
      didLogHeartbeatStrip,
      blockStreamingEnabled: effectiveBlockStreamingEnabled,
      blockReplyPipeline,
      replyToMode,
      replyToChannel,
      currentMessageId: sessionCtx.MessageSid,
      messageProvider: followupRun.run.messageProvider,
      messagingToolSentTexts: runResult.messagingToolSentTexts,
      messagingToolSentTargets: runResult.messagingToolSentTargets,
      originatingTo: sessionCtx.OriginatingTo ?? sessionCtx.To,
      accountId: sessionCtx.AccountId,
    });
    const { replyPayloads } = payloadResult;
    didLogHeartbeatStrip = payloadResult.didLogHeartbeatStrip;

    if (replyPayloads.length === 0)
      return finalizeWithFollowup(undefined, queueKey, runFollowupTurn);

    await signalTypingIfNeeded(replyPayloads, typingSignals);

    const usage = runResult.meta.agentMeta?.usage;
    const modelUsed = runResult.meta.agentMeta?.model ?? fallbackModel ?? defaultModel;
    const providerUsed =
      runResult.meta.agentMeta?.provider ?? fallbackProvider ?? followupRun.run.provider;
    const cliSessionId = isCliProvider(providerUsed, cfg)
      ? runResult.meta.agentMeta?.sessionId?.trim()
      : undefined;
    const contextTokensUsed =
      agentCfgContextTokens ??
      lookupContextTokens(modelUsed) ??
      activeSessionEntry?.contextTokens ??
      DEFAULT_CONTEXT_TOKENS;

    if (storePath && sessionKey) {
      if (hasNonzeroUsage(usage)) {
        try {
          await updateSessionStoreEntry({
            storePath,
            sessionKey,
            update: async (entry) => {
              const input = usage.input ?? 0;
              const output = usage.output ?? 0;
              const promptTokens = input + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
              const patch: Partial<SessionEntry> = {
                inputTokens: input,
                outputTokens: output,
                totalTokens: promptTokens > 0 ? promptTokens : (usage.total ?? input),
                modelProvider: providerUsed,
                model: modelUsed,
                contextTokens: contextTokensUsed ?? entry.contextTokens,
                systemPromptReport: runResult.meta.systemPromptReport ?? entry.systemPromptReport,
                updatedAt: Date.now(),
              };
              if (cliSessionId) {
                const nextEntry = { ...entry, ...patch };
                setCliSessionId(nextEntry, providerUsed, cliSessionId);
                return {
                  ...patch,
                  cliSessionIds: nextEntry.cliSessionIds,
                  claudeCliSessionId: nextEntry.claudeCliSessionId,
                };
              }
              return patch;
            },
          });
        } catch (err) {
          logVerbose(`failed to persist usage update: ${String(err)}`);
        }
      } else if (modelUsed || contextTokensUsed) {
        try {
          await updateSessionStoreEntry({
            storePath,
            sessionKey,
            update: async (entry) => {
              const patch: Partial<SessionEntry> = {
                modelProvider: providerUsed ?? entry.modelProvider,
                model: modelUsed ?? entry.model,
                contextTokens: contextTokensUsed ?? entry.contextTokens,
                systemPromptReport: runResult.meta.systemPromptReport ?? entry.systemPromptReport,
                updatedAt: Date.now(),
              };
              if (cliSessionId) {
                const nextEntry = { ...entry, ...patch };
                setCliSessionId(nextEntry, providerUsed, cliSessionId);
                return {
                  ...patch,
                  cliSessionIds: nextEntry.cliSessionIds,
                  claudeCliSessionId: nextEntry.claudeCliSessionId,
                };
              }
              return patch;
            },
          });
        } catch (err) {
          logVerbose(`failed to persist model/context update: ${String(err)}`);
        }
      }
    }

    const responseUsageEnabled =
      (activeSessionEntry?.responseUsage ??
        (sessionKey ? activeSessionStore?.[sessionKey]?.responseUsage : undefined)) === "on";
    if (responseUsageEnabled && hasNonzeroUsage(usage)) {
      const authMode = resolveModelAuthMode(providerUsed, cfg);
      const showCost = authMode === "api-key";
      const costConfig = showCost
        ? resolveModelCostConfig({
            provider: providerUsed,
            model: modelUsed,
            config: cfg,
          })
        : undefined;
      const formatted = formatResponseUsageLine({
        usage,
        showCost,
        costConfig,
      });
      if (formatted) responseUsageLine = formatted;
    }

    // If verbose is enabled and this is a new session, prepend a session hint.
    let finalPayloads = replyPayloads;
    if (autoCompactionCompleted) {
      const count = await incrementCompactionCount({
        sessionEntry: activeSessionEntry,
        sessionStore: activeSessionStore,
        sessionKey,
        storePath,
      });
      if (resolvedVerboseLevel === "on") {
        const suffix = typeof count === "number" ? ` (count ${count})` : "";
        finalPayloads = [{ text: `🧹 Auto-compaction complete${suffix}.` }, ...finalPayloads];
      }
    }
    if (resolvedVerboseLevel === "on" && activeIsNewSession) {
      finalPayloads = [{ text: `🧭 New session: ${followupRun.run.sessionId}` }, ...finalPayloads];
    }
    if (responseUsageLine) {
      finalPayloads = appendUsageLine(finalPayloads, responseUsageLine);
    }

    return finalizeWithFollowup(
      finalPayloads.length === 1 ? finalPayloads[0] : finalPayloads,
      queueKey,
      runFollowupTurn,
    );
  } finally {
    blockReplyPipeline?.stop();
    typing.markRunComplete();
  }
}
