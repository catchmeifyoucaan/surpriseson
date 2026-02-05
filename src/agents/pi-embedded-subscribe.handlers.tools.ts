import type { AgentEvent } from "@mariozechner/pi-agent-core";

import { emitAgentEvent } from "../infra/agent-events.js";
import { normalizeTextForComparison } from "./pi-embedded-helpers.js";
import { isMessagingTool, isMessagingToolSendAction } from "./pi-embedded-messaging.js";
import type { EmbeddedPiSubscribeContext } from "./pi-embedded-subscribe.handlers.types.js";
import {
  extractMessagingToolSend,
  isToolResultError,
  sanitizeToolResult,
} from "./pi-embedded-subscribe.tools.js";
import { inferToolMetaFromArgs } from "./pi-embedded-utils.js";

export function handleToolExecutionStart(
  ctx: EmbeddedPiSubscribeContext,
  evt: AgentEvent & { toolName: string; toolCallId: string; args: unknown },
) {
  // Flush pending block replies to preserve message boundaries before tool execution.
  ctx.flushBlockReplyBuffer();
  if (ctx.params.onBlockReplyFlush) {
    void ctx.params.onBlockReplyFlush();
  }

  const toolName = String(evt.toolName);
  const toolCallId = String(evt.toolCallId);
  const args = evt.args;

  if (toolName === "read") {
    const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    const filePath = typeof record.path === "string" ? record.path.trim() : "";
    if (!filePath) {
      const argsPreview = typeof args === "string" ? args.slice(0, 200) : undefined;
      ctx.log.warn(
        `read tool called without path: toolCallId=${toolCallId} argsType=${typeof args}${argsPreview ? ` argsPreview=${argsPreview}` : ""}`,
      );
    }
  }

  const meta = inferToolMetaFromArgs(toolName, args);
  const startedAt = Date.now();
  ctx.state.toolCallsStarted += 1;
  ctx.state.toolMetaById.set(toolCallId, { name: toolName, meta, startedAt });
  const timeoutMs = ctx.state.toolTimeoutMs;
  const heartbeatMs = ctx.state.toolHeartbeatMs;
  const shouldEmitToolEvents = ctx.shouldEmitToolResult();
  const onToolResult = ctx.params.onToolResult;
  if (heartbeatMs && heartbeatMs > 0 && shouldEmitToolEvents && onToolResult) {
    const heartbeatTimer = setInterval(() => {
      const entry = ctx.state.toolMetaById.get(toolCallId);
      if (!entry) {
        clearInterval(heartbeatTimer);
        ctx.state.toolHeartbeats.delete(toolCallId);
        return;
      }
      const elapsedMs = Date.now() - (entry.startedAt ?? startedAt);
      const elapsedSec = Math.max(1, Math.floor(elapsedMs / 1000));
      const metaPreview =
        entry.meta && entry.meta.length > 80 ? `${entry.meta.slice(0, 77)}...` : entry.meta;
      const metaLabel = metaPreview ? ` ${metaPreview}` : "";
      try {
        void onToolResult({
          text: `⏳ Still running: ${toolName} (${toolCallId}${metaLabel}) — ${elapsedSec}s elapsed.`,
        });
      } catch {
        // ignore tool result delivery failures
      }
    }, heartbeatMs);
    ctx.state.toolHeartbeats.set(toolCallId, heartbeatTimer);
  }
  if (timeoutMs && timeoutMs > 0) {
    const timer = setTimeout(() => {
      const entry = ctx.state.toolMetaById.get(toolCallId);
      if (!entry) return;
      entry.timedOut = true;
      ctx.state.toolMetaById.set(toolCallId, entry);
      ctx.log.warn(
        `tool timeout: runId=${ctx.params.runId} tool=${toolName} toolCallId=${toolCallId} timeoutMs=${timeoutMs}`,
      );
      if (ctx.params.toolResultPolicy?.warnOnTimeout && ctx.params.onToolResult) {
        try {
          void ctx.params.onToolResult({
            text: `⚠️ Tool timeout: ${toolName} (${toolCallId}) exceeded ${timeoutMs}ms.`,
          });
        } catch {
          // ignore tool result delivery failures
        }
      }
    }, timeoutMs);
    ctx.state.toolTimeouts.set(toolCallId, timer);
  }
  ctx.log.debug(
    `embedded run tool start: runId=${ctx.params.runId} tool=${toolName} toolCallId=${toolCallId}`,
  );

  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "tool",
    data: {
      phase: "start",
      name: toolName,
      toolCallId,
      args: args as Record<string, unknown>,
    },
  });
  ctx.params.onAgentEvent?.({
    stream: "tool",
    data: { phase: "start", name: toolName, toolCallId },
  });

  if (
    ctx.params.onToolResult &&
    shouldEmitToolEvents &&
    !ctx.state.toolSummaryById.has(toolCallId)
  ) {
    ctx.state.toolSummaryById.add(toolCallId);
    ctx.emitToolSummary(toolName, meta);
  }

  // Track messaging tool sends (pending until confirmed in tool_execution_end).
  if (isMessagingTool(toolName)) {
    const argsRecord = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
    const isMessagingSend = isMessagingToolSendAction(toolName, argsRecord);
    if (isMessagingSend) {
      const sendTarget = extractMessagingToolSend(toolName, argsRecord);
      if (sendTarget) {
        ctx.state.pendingMessagingTargets.set(toolCallId, sendTarget);
      }
      // Field names vary by tool: Discord/Slack use "content", sessions_send uses "message"
      const text = (argsRecord.content as string) ?? (argsRecord.message as string);
      if (text && typeof text === "string") {
        ctx.state.pendingMessagingTexts.set(toolCallId, text);
        ctx.log.debug(`Tracking pending messaging text: tool=${toolName} len=${text.length}`);
      }
    }
  }
}

export function handleToolExecutionUpdate(
  ctx: EmbeddedPiSubscribeContext,
  evt: AgentEvent & {
    toolName: string;
    toolCallId: string;
    partialResult?: unknown;
  },
) {
  const toolName = String(evt.toolName);
  const toolCallId = String(evt.toolCallId);
  const partial = evt.partialResult;
  const sanitized = sanitizeToolResult(partial);
  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "tool",
    data: {
      phase: "update",
      name: toolName,
      toolCallId,
      partialResult: sanitized,
    },
  });
  ctx.params.onAgentEvent?.({
    stream: "tool",
    data: {
      phase: "update",
      name: toolName,
      toolCallId,
    },
  });
}

export function handleToolExecutionEnd(
  ctx: EmbeddedPiSubscribeContext,
  evt: AgentEvent & {
    toolName: string;
    toolCallId: string;
    isError: boolean;
    result?: unknown;
  },
) {
  const toolName = String(evt.toolName);
  const toolCallId = String(evt.toolCallId);
  const isError = Boolean(evt.isError);
  const result = evt.result;
  const isToolError = isError || isToolResultError(result);
  const sanitizedResult = sanitizeToolResult(result);
  const metaEntry = ctx.state.toolMetaById.get(toolCallId);
  const meta = metaEntry?.meta;
  ctx.state.toolMetas.push({ toolName, meta });
  ctx.state.toolMetaById.delete(toolCallId);
  ctx.state.toolSummaryById.delete(toolCallId);
  ctx.state.toolCallsEnded += 1;
  const timer = ctx.state.toolTimeouts.get(toolCallId);
  if (timer) {
    clearTimeout(timer);
    ctx.state.toolTimeouts.delete(toolCallId);
  }
  const heartbeatTimer = ctx.state.toolHeartbeats.get(toolCallId);
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    ctx.state.toolHeartbeats.delete(toolCallId);
  }

  // Commit messaging tool text on success, discard on error.
  const pendingText = ctx.state.pendingMessagingTexts.get(toolCallId);
  const pendingTarget = ctx.state.pendingMessagingTargets.get(toolCallId);
  if (pendingText) {
    ctx.state.pendingMessagingTexts.delete(toolCallId);
    if (!isToolError) {
      ctx.state.messagingToolSentTexts.push(pendingText);
      ctx.state.messagingToolSentTextsNormalized.push(normalizeTextForComparison(pendingText));
      ctx.log.debug(`Committed messaging text: tool=${toolName} len=${pendingText.length}`);
      ctx.trimMessagingToolSent();
    }
  }
  if (pendingTarget) {
    ctx.state.pendingMessagingTargets.delete(toolCallId);
    if (!isToolError) {
      ctx.state.messagingToolSentTargets.push(pendingTarget);
      ctx.trimMessagingToolSent();
    }
  }

  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "tool",
    data: {
      phase: "result",
      name: toolName,
      toolCallId,
      meta,
      isError: isToolError,
      result: sanitizedResult,
    },
  });
  ctx.params.onAgentEvent?.({
    stream: "tool",
    data: {
      phase: "result",
      name: toolName,
      toolCallId,
      meta,
      isError: isToolError,
    },
  });

  ctx.log.debug(
    `embedded run tool end: runId=${ctx.params.runId} tool=${toolName} toolCallId=${toolCallId}`,
  );
}
