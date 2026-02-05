import type { AgentEvent } from "@mariozechner/pi-agent-core";

import { emitAgentEvent } from "../infra/agent-events.js";
import { createInlineCodeState } from "../markdown/code-spans.js";
import type { EmbeddedPiSubscribeContext } from "./pi-embedded-subscribe.handlers.types.js";

export function handleAgentStart(ctx: EmbeddedPiSubscribeContext) {
  ctx.log.debug(`embedded run agent start: runId=${ctx.params.runId}`);
  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "lifecycle",
    data: {
      phase: "start",
      startedAt: Date.now(),
    },
  });
  ctx.params.onAgentEvent?.({
    stream: "lifecycle",
    data: { phase: "start" },
  });
}

export function handleAutoCompactionStart(ctx: EmbeddedPiSubscribeContext) {
  ctx.state.compactionInFlight = true;
  ctx.ensureCompactionPromise();
  ctx.log.debug(`embedded run compaction start: runId=${ctx.params.runId}`);
  ctx.params.onAgentEvent?.({
    stream: "compaction",
    data: { phase: "start" },
  });
}

export function handleAutoCompactionEnd(
  ctx: EmbeddedPiSubscribeContext,
  evt: AgentEvent & { willRetry?: unknown },
) {
  ctx.state.compactionInFlight = false;
  const willRetry = Boolean(evt.willRetry);
  if (willRetry) {
    ctx.noteCompactionRetry();
    ctx.resetForCompactionRetry();
    ctx.log.debug(`embedded run compaction retry: runId=${ctx.params.runId}`);
  } else {
    ctx.maybeResolveCompactionWait();
  }
  ctx.params.onAgentEvent?.({
    stream: "compaction",
    data: { phase: "end", willRetry },
  });
}

export function handleAgentEnd(ctx: EmbeddedPiSubscribeContext) {
  ctx.log.debug(`embedded run agent end: runId=${ctx.params.runId}`);
  emitAgentEvent({
    runId: ctx.params.runId,
    stream: "lifecycle",
    data: {
      phase: "end",
      endedAt: Date.now(),
    },
  });
  ctx.params.onAgentEvent?.({
    stream: "lifecycle",
    data: { phase: "end" },
  });

  ctx.state.toolTimeouts.forEach((timer) => clearTimeout(timer));
  ctx.state.toolTimeouts.clear();
  ctx.state.toolHeartbeats.forEach((timer) => clearInterval(timer));
  ctx.state.toolHeartbeats.clear();

  if (ctx.state.toolMetaById.size > 0) {
    const pending = Array.from(ctx.state.toolMetaById.entries());
    const preview = pending
      .slice(0, 5)
      .map(([id, entry]) => `${entry.name}(${id}${entry.meta ? ` ${entry.meta}` : ""})`)
      .join(", ");
    ctx.log.warn(
      `embedded run ended with missing tool results: runId=${ctx.params.runId} count=${pending.length} pending=${preview}`,
    );
    if (ctx.params.toolResultPolicy?.warnOnMissing && ctx.params.onToolResult) {
      const lines = [
        "⚠️ Missing tool results detected (tool execution may not have completed):",
        ...pending
          .slice(0, 5)
          .map(
            ([id, entry]) =>
              `- ${entry.name} (${id}${entry.meta ? ` ${entry.meta}` : ""})`,
          ),
        pending.length > 5 ? `… +${pending.length - 5} more` : "",
      ].filter(Boolean);
      try {
        void ctx.params.onToolResult({ text: lines.join("\n") });
      } catch {
        // avoid throwing during agent end
      }
    }
  }

  if (ctx.params.onBlockReply) {
    if (ctx.blockChunker?.hasBuffered()) {
      ctx.blockChunker.drain({ force: true, emit: ctx.emitBlockChunk });
      ctx.blockChunker.reset();
    } else if (ctx.state.blockBuffer.length > 0) {
      ctx.emitBlockChunk(ctx.state.blockBuffer);
      ctx.state.blockBuffer = "";
    }
  }

  ctx.state.blockState.thinking = false;
  ctx.state.blockState.final = false;
  ctx.state.blockState.inlineCode = createInlineCodeState();

  if (ctx.state.pendingCompactionRetry > 0) {
    ctx.resolveCompactionRetry();
  } else {
    ctx.maybeResolveCompactionWait();
  }
}
