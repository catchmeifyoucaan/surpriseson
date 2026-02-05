import { resolveTextChunkLimit } from "../../auto-reply/chunk.js";
import type { ReplyPayload } from "../../auto-reply/types.js";
import { resolveChannelMediaMaxBytes } from "../../channels/plugins/media-limits.js";
import { loadChannelOutboundAdapter } from "../../channels/plugins/outbound/load.js";
import type { ChannelOutboundAdapter } from "../../channels/plugins/types.js";
import type { SurprisebotConfig } from "../../config/config.js";
import type { sendMessageDiscord } from "../../discord/send.js";
import type { sendMessageIMessage } from "../../imessage/send.js";
import { markdownToSignalTextChunks, type SignalTextStyleRange } from "../../signal/format.js";
import { sendMessageSignal } from "../../signal/send.js";
import type { sendMessageSlack } from "../../slack/send.js";
import type { sendMessageTelegram } from "../../telegram/send.js";
import type { sendMessageWhatsApp } from "../../web/outbound.js";
import { formatAlertPayloads, isCriticalAlertTarget } from "../alerts.js";
import { scoreSignal } from "../signal-score.js";
import { appendMissionControlRecord } from "../mission-control/ledger.js";
import { applyReconStatusGate } from "../recon-status.js";
import type { NormalizedOutboundPayload } from "./payloads.js";
import { normalizeOutboundPayloads } from "./payloads.js";
import type { OutboundChannel } from "./targets.js";

export type { NormalizedOutboundPayload } from "./payloads.js";
export { normalizeOutboundPayloads } from "./payloads.js";

type SendMatrixMessage = (
  to: string,
  text: string,
  opts?: { mediaUrl?: string; replyToId?: string; threadId?: string; timeoutMs?: number },
) => Promise<{ messageId: string; roomId: string }>;

export type OutboundSendDeps = {
  sendWhatsApp?: typeof sendMessageWhatsApp;
  sendTelegram?: typeof sendMessageTelegram;
  sendDiscord?: typeof sendMessageDiscord;
  sendSlack?: typeof sendMessageSlack;
  sendSignal?: typeof sendMessageSignal;
  sendIMessage?: typeof sendMessageIMessage;
  sendMatrix?: SendMatrixMessage;
  sendMSTeams?: (
    to: string,
    text: string,
    opts?: { mediaUrl?: string },
  ) => Promise<{ messageId: string; conversationId: string }>;
};

export type OutboundDeliveryResult = {
  channel: Exclude<OutboundChannel, "none">;
  messageId: string;
  chatId?: string;
  channelId?: string;
  roomId?: string;
  conversationId?: string;
  timestamp?: number;
  toJid?: string;
  pollId?: string;
  // Channel docking: stash channel-specific fields here to avoid core type churn.
  meta?: Record<string, unknown>;
};

type Chunker = (text: string, limit: number) => string[];

type ChannelHandler = {
  chunker: Chunker | null;
  textChunkLimit?: number;
  sendText: (text: string) => Promise<OutboundDeliveryResult>;
  sendMedia: (caption: string, mediaUrl: string) => Promise<OutboundDeliveryResult>;
};

function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw new Error("Outbound delivery aborted");
  }
}

// Channel docking: outbound delivery delegates to plugin.outbound adapters.
async function createChannelHandler(params: {
  cfg: SurprisebotConfig;
  channel: Exclude<OutboundChannel, "none">;
  to: string;
  accountId?: string;
  replyToId?: string | null;
  threadId?: string | number | null;
  deps?: OutboundSendDeps;
  gifPlayback?: boolean;
}): Promise<ChannelHandler> {
  const outbound = await loadChannelOutboundAdapter(params.channel);
  if (!outbound?.sendText || !outbound?.sendMedia) {
    throw new Error(`Outbound not configured for channel: ${params.channel}`);
  }
  const handler = createPluginHandler({
    outbound,
    cfg: params.cfg,
    channel: params.channel,
    to: params.to,
    accountId: params.accountId,
    replyToId: params.replyToId,
    threadId: params.threadId,
    deps: params.deps,
    gifPlayback: params.gifPlayback,
  });
  if (!handler) {
    throw new Error(`Outbound not configured for channel: ${params.channel}`);
  }
  return handler;
}

function createPluginHandler(params: {
  outbound?: ChannelOutboundAdapter;
  cfg: SurprisebotConfig;
  channel: Exclude<OutboundChannel, "none">;
  to: string;
  accountId?: string;
  replyToId?: string | null;
  threadId?: string | number | null;
  deps?: OutboundSendDeps;
  gifPlayback?: boolean;
}): ChannelHandler | null {
  const outbound = params.outbound;
  if (!outbound?.sendText || !outbound?.sendMedia) return null;
  const sendText = outbound.sendText;
  const sendMedia = outbound.sendMedia;
  const chunker = outbound.chunker ?? null;
  return {
    chunker,
    textChunkLimit: outbound.textChunkLimit,
    sendText: async (text) =>
      sendText({
        cfg: params.cfg,
        to: params.to,
        text,
        accountId: params.accountId,
        replyToId: params.replyToId,
        threadId: params.threadId,
        gifPlayback: params.gifPlayback,
        deps: params.deps,
      }),
    sendMedia: async (caption, mediaUrl) =>
      sendMedia({
        cfg: params.cfg,
        to: params.to,
        text: caption,
        mediaUrl,
        accountId: params.accountId,
        replyToId: params.replyToId,
        threadId: params.threadId,
        gifPlayback: params.gifPlayback,
        deps: params.deps,
      }),
  };
}

async function applyHighSignalGate(params: {
  cfg: SurprisebotConfig;
  channel: Exclude<OutboundChannel, "none">;
  to: string;
  payloads: ReplyPayload[];
}): Promise<ReplyPayload[]> {
  const alerts = params.cfg.missionControl?.alerts;
  if (!alerts?.highSignalOnly) return params.payloads;
  if (!isCriticalAlertTarget({ cfg: params.cfg, channel: params.channel, to: params.to })) {
    return params.payloads;
  }
  const minScore = alerts.minSignalScore ?? 60;
  const minEvidence = alerts.minEvidenceCount ?? 1;
  const suppressMissing = alerts.suppressIfMissingEvidence ?? true;
  const allowed: ReplyPayload[] = [];
  for (const payload of params.payloads) {
    const text = payload.text?.trim() ?? "";
    const allowBypass = /HEARTBEAT|DAILY STANDUP|WEEKLY DEEP REPORT|HEALTH DASHBOARD|I'M BACK UP/i.test(text);
    if (allowBypass) {
      allowed.push(payload);
      continue;
    }
    if (!text) {
      if (!suppressMissing) allowed.push(payload);
      continue;
    }
    const scored = scoreSignal(text);
    const ok = scored.score >= minScore && (scored.evidenceCount >= minEvidence || !suppressMissing);
    if (ok) {
      allowed.push(payload);
    } else {
      appendMissionControlRecord({
        cfg: params.cfg,
        kind: "activities",
        record: {
          id: `activity-${Date.now()}-${Math.random().toString(16).slice(2, 8)}` ,
          ts: new Date().toISOString(),
          source: "system",
          version: 1,
          type: "alert_suppressed",
          message: `Suppressed alert (score ${scored.score})`,
          meta: { score: scored.score, evidenceCount: scored.evidenceCount, reasons: scored.reasons },
        } as any,
      }).catch(() => {});
    }
  }
  return allowed;
}


export async function deliverOutboundPayloads(params: {
  cfg: SurprisebotConfig;
  channel: Exclude<OutboundChannel, "none">;
  to: string;
  accountId?: string;
  payloads: ReplyPayload[];
  replyToId?: string | null;
  threadId?: string | number | null;
  deps?: OutboundSendDeps;
  gifPlayback?: boolean;
  abortSignal?: AbortSignal;
  bestEffort?: boolean;
  onError?: (err: unknown, payload: NormalizedOutboundPayload) => void;
  onPayload?: (payload: NormalizedOutboundPayload) => void;
}): Promise<OutboundDeliveryResult[]> {
  const { cfg, channel, to, payloads } = params;
  const accountId = params.accountId;
  const deps = params.deps;
  const abortSignal = params.abortSignal;
  const sendSignal = params.deps?.sendSignal ?? sendMessageSignal;
  const results: OutboundDeliveryResult[] = [];
  const handler = await createChannelHandler({
    cfg,
    channel,
    to,
    deps,
    accountId,
    replyToId: params.replyToId,
    threadId: params.threadId,
    gifPlayback: params.gifPlayback,
  });
  const textLimit = handler.chunker
    ? resolveTextChunkLimit(cfg, channel, accountId, {
        fallbackLimit: handler.textChunkLimit,
      })
    : undefined;
  const isSignalChannel = channel === "signal";
  const signalMaxBytes = isSignalChannel
    ? resolveChannelMediaMaxBytes({
        cfg,
        resolveChannelLimitMb: ({ cfg, accountId }) =>
          cfg.channels?.signal?.accounts?.[accountId]?.mediaMaxMb ??
          cfg.channels?.signal?.mediaMaxMb,
        accountId,
      })
    : undefined;

  const sendTextChunks = async (text: string) => {
    throwIfAborted(abortSignal);
    if (!handler.chunker || textLimit === undefined) {
      results.push(await handler.sendText(text));
      return;
    }
    for (const chunk of handler.chunker(text, textLimit)) {
      throwIfAborted(abortSignal);
      results.push(await handler.sendText(chunk));
    }
  };

  const sendSignalText = async (text: string, styles: SignalTextStyleRange[]) => {
    throwIfAborted(abortSignal);
    return {
      channel: "signal" as const,
      ...(await sendSignal(to, text, {
        maxBytes: signalMaxBytes,
        accountId: accountId ?? undefined,
        textMode: "plain",
        textStyles: styles,
      })),
    };
  };

  const sendSignalTextChunks = async (text: string) => {
    throwIfAborted(abortSignal);
    let signalChunks =
      textLimit === undefined
        ? markdownToSignalTextChunks(text, Number.POSITIVE_INFINITY)
        : markdownToSignalTextChunks(text, textLimit);
    if (signalChunks.length === 0 && text) {
      signalChunks = [{ text, styles: [] }];
    }
    for (const chunk of signalChunks) {
      throwIfAborted(abortSignal);
      results.push(await sendSignalText(chunk.text, chunk.styles));
    }
  };

  const sendSignalMedia = async (caption: string, mediaUrl: string) => {
    throwIfAborted(abortSignal);
    const formatted = markdownToSignalTextChunks(caption, Number.POSITIVE_INFINITY)[0] ?? {
      text: caption,
      styles: [],
    };
    return {
      channel: "signal" as const,
      ...(await sendSignal(to, formatted.text, {
        mediaUrl,
        maxBytes: signalMaxBytes,
        accountId: accountId ?? undefined,
        textMode: "plain",
        textStyles: formatted.styles,
      })),
    };
  };
  const gatedPayloads = await applyReconStatusGate({ cfg, payloads });
  const highSignalPayloads = await applyHighSignalGate({ cfg, channel, to, payloads: gatedPayloads });
  const alertPayloads =
    isCriticalAlertTarget({ cfg, channel, to }) ? formatAlertPayloads(highSignalPayloads) : highSignalPayloads;
  const normalizedPayloads = normalizeOutboundPayloads(alertPayloads);
  for (const payload of normalizedPayloads) {
    try {
      throwIfAborted(abortSignal);
      params.onPayload?.(payload);
      if (payload.mediaUrls.length === 0) {
        if (isSignalChannel) {
          await sendSignalTextChunks(payload.text);
        } else {
          await sendTextChunks(payload.text);
        }
        continue;
      }

      let first = true;
      for (const url of payload.mediaUrls) {
        throwIfAborted(abortSignal);
        const caption = first ? payload.text : "";
        first = false;
        if (isSignalChannel) {
          results.push(await sendSignalMedia(caption, url));
        } else {
          results.push(await handler.sendMedia(caption, url));
        }
      }
    } catch (err) {
      if (!params.bestEffort) throw err;
      params.onError?.(err, payload);
    }
  }
  return results;
}
