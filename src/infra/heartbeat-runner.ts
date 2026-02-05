import { resolveEffectiveMessagesConfig } from "../agents/identity.js";
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";
import {
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  DEFAULT_HEARTBEAT_EVERY,
  resolveHeartbeatPrompt as resolveHeartbeatPromptText,
  stripHeartbeatToken,
} from "../auto-reply/heartbeat.js";
import { getReplyFromConfig } from "../auto-reply/reply.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import { getChannelPlugin, normalizeChannelId } from "../channels/plugins/index.js";
import type { ChannelHeartbeatDeps } from "../channels/plugins/types.js";
import { parseDurationMs } from "../cli/parse-duration.js";
import type { SurprisebotConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import {
  loadSessionStore,
  resolveAgentIdFromSessionKey,
  resolveMainSessionKey,
  resolveStorePath,
  saveSessionStore,
} from "../config/sessions.js";
import { formatErrorMessage } from "../infra/errors.js";
import { createSubsystemLogger } from "../logging.js";
import { getQueueSize } from "../process/command-queue.js";
import { defaultRuntime, type RuntimeEnv } from "../runtime.js";
import { INTERNAL_MESSAGE_CHANNEL } from "../utils/message-channel.js";
import { emitHeartbeatEvent } from "./heartbeat-events.js";
import {
  type HeartbeatRunResult,
  requestHeartbeatNow,
  setHeartbeatWakeHandler,
} from "./heartbeat-wake.js";
import type { OutboundSendDeps } from "./outbound/deliver.js";
import { deliverOutboundPayloads } from "./outbound/deliver.js";
import { resolveHeartbeatDeliveryTarget } from "./outbound/targets.js";

type HeartbeatDeps = OutboundSendDeps &
  ChannelHeartbeatDeps & {
    runtime?: RuntimeEnv;
    getQueueSize?: (lane?: string) => number;
    nowMs?: () => number;
  };

const log = createSubsystemLogger("gateway/heartbeat");
let heartbeatsEnabled = true;
let lastHeartbeatAtMs = 0;

const TOOL_UNAVAILABLE_RE = /\b(tool|tools|memory_search|memory_get|telegram send tool|message tool)\b.*\b(unavailable|not available|disabled|cannot|can't)\b/i;
const execFileAsync = promisify(execFile);
const DEFAULT_QMD_BIN = "/usr/local/bin/qmd";

async function getQmdHealth(): Promise<{ ok: boolean; detail: string }> {
  const bin = process.env.QMD_BIN?.trim() || DEFAULT_QMD_BIN;
  try {
    await access(bin);
  } catch (err) {
    return { ok: false, detail: `missing:${bin}` };
  }

  try {
    await execFileAsync(bin, ["collection", "list"], { timeout: 5_000 });
    return { ok: true, detail: "ok" };
  } catch (err) {
    return { ok: false, detail: formatErrorMessage(err) };
  }
}


export function setHeartbeatsEnabled(enabled: boolean) {
  heartbeatsEnabled = enabled;
}

export function resolveHeartbeatIntervalMs(cfg: SurprisebotConfig, overrideEvery?: string) {
  const raw = overrideEvery ?? cfg.agents?.defaults?.heartbeat?.every ?? DEFAULT_HEARTBEAT_EVERY;
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  let ms: number;
  try {
    ms = parseDurationMs(trimmed, { defaultUnit: "m" });
  } catch {
    return null;
  }
  if (ms <= 0) return null;
  return ms;
}

export function resolveHeartbeatPrompt(cfg: SurprisebotConfig) {
  return resolveHeartbeatPromptText(cfg.agents?.defaults?.heartbeat?.prompt);
}

function resolveHeartbeatMinIntervalMs(cfg: SurprisebotConfig): number {
  const raw = (cfg.agents?.defaults as { heartbeat?: { minIntervalMinutes?: number } } | undefined)?.heartbeat?.minIntervalMinutes;
  const minutes = typeof raw === "number" && Number.isFinite(raw) ? raw : 5;
  return Math.max(1, Math.floor(minutes)) * 60_000;
}

function resolveHeartbeatAckMaxChars(cfg: SurprisebotConfig) {
  return Math.max(
    0,
    cfg.agents?.defaults?.heartbeat?.ackMaxChars ?? DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  );
}

function resolveHeartbeatSession(cfg: SurprisebotConfig) {
  const sessionCfg = cfg.session;
  const scope = sessionCfg?.scope ?? "per-sender";
  const sessionKey = scope === "global" ? "global" : resolveMainSessionKey(cfg);
  const agentId = resolveAgentIdFromSessionKey(sessionKey);
  const storePath = resolveStorePath(sessionCfg?.store, { agentId });
  const store = loadSessionStore(storePath);
  const entry = store[sessionKey];
  return { sessionKey, storePath, store, entry };
}

function resolveHeartbeatReplyPayload(
  replyResult: ReplyPayload | ReplyPayload[] | undefined,
): ReplyPayload | undefined {
  if (!replyResult) return undefined;
  if (!Array.isArray(replyResult)) return replyResult;
  for (let idx = replyResult.length - 1; idx >= 0; idx -= 1) {
    const payload = replyResult[idx];
    if (!payload) continue;
    if (payload.text || payload.mediaUrl || (payload.mediaUrls && payload.mediaUrls.length > 0)) {
      return payload;
    }
  }
  return undefined;
}

function resolveHeartbeatReasoningPayloads(
  replyResult: ReplyPayload | ReplyPayload[] | undefined,
): ReplyPayload[] {
  const payloads = Array.isArray(replyResult) ? replyResult : replyResult ? [replyResult] : [];
  return payloads.filter((payload) => {
    const text = typeof payload.text === "string" ? payload.text : "";
    return text.trimStart().startsWith("Reasoning:");
  });
}

function sanitizeHeartbeatText(text?: string): string {
  if (!text) return "";
  const lines = text.split(/\r?\n/);
  const filtered = lines.filter((line) => !TOOL_UNAVAILABLE_RE.test(line));
  return filtered.join("\n").trim();
}

function resolveHeartbeatSender(params: {
  allowFrom: Array<string | number>;
  lastTo?: string;
  provider?: string | null;
}) {
  const { allowFrom, lastTo, provider } = params;
  const candidates = [
    lastTo?.trim(),
    provider && lastTo ? `${provider}:${lastTo}` : undefined,
  ].filter((val): val is string => Boolean(val?.trim()));

  const allowList = allowFrom
    .map((entry) => String(entry))
    .filter((entry) => entry && entry !== "*");
  if (allowFrom.includes("*")) {
    return candidates[0] ?? "heartbeat";
  }
  if (candidates.length > 0 && allowList.length > 0) {
    const matched = candidates.find((candidate) => allowList.includes(candidate));
    if (matched) return matched;
  }
  if (candidates.length > 0 && allowList.length === 0) {
    return candidates[0];
  }
  if (allowList.length > 0) return allowList[0];
  return candidates[0] ?? "heartbeat";
}

async function restoreHeartbeatUpdatedAt(params: {
  storePath: string;
  sessionKey: string;
  updatedAt?: number;
}) {
  const { storePath, sessionKey, updatedAt } = params;
  if (typeof updatedAt !== "number") return;
  const store = loadSessionStore(storePath);
  const entry = store[sessionKey];
  if (!entry) return;
  const nextUpdatedAt = Math.max(entry.updatedAt ?? 0, updatedAt);
  if (entry.updatedAt === nextUpdatedAt) return;
  store[sessionKey] = { ...entry, updatedAt: nextUpdatedAt };
  await saveSessionStore(storePath, store);
}

function normalizeHeartbeatReply(
  payload: ReplyPayload,
  responsePrefix: string | undefined,
  ackMaxChars: number,
) {
  const stripped = stripHeartbeatToken(payload.text, {
    mode: "heartbeat",
    maxAckChars: ackMaxChars,
  });
  const hasMedia = Boolean(payload.mediaUrl || (payload.mediaUrls?.length ?? 0) > 0);
  if (stripped.shouldSkip && !hasMedia) {
    return {
      shouldSkip: true,
      text: "",
      hasMedia,
    };
  }
  let finalText = stripped.text;
  if (responsePrefix && finalText && !finalText.startsWith(responsePrefix)) {
    finalText = `${responsePrefix} ${finalText}`;
  }
  return { shouldSkip: false, text: finalText, hasMedia };
}

export async function runHeartbeatOnce(opts: {
  cfg?: SurprisebotConfig;
  reason?: string;
  deps?: HeartbeatDeps;
}): Promise<HeartbeatRunResult> {
  const cfg = opts.cfg ?? loadConfig();
  if (!heartbeatsEnabled) {
    return { status: "skipped", reason: "disabled" };
  }
  if (!resolveHeartbeatIntervalMs(cfg)) {
    return { status: "skipped", reason: "disabled" };
  }

  const queueSize = (opts.deps?.getQueueSize ?? getQueueSize)("main");
  if (queueSize > 0) {
    return { status: "skipped", reason: "requests-in-flight" };
  }

  const startedAt = opts.deps?.nowMs?.() ?? Date.now();
  const minIntervalMs = resolveHeartbeatMinIntervalMs(cfg);
  if (startedAt - lastHeartbeatAtMs < minIntervalMs) {
    return { status: "skipped", reason: "cooldown" };
  }
  const { entry, sessionKey, storePath } = resolveHeartbeatSession(cfg);
  const previousUpdatedAt = entry?.updatedAt;
  const delivery = resolveHeartbeatDeliveryTarget({ cfg, entry });
  const lastChannel =
    entry?.lastChannel && entry.lastChannel !== INTERNAL_MESSAGE_CHANNEL
      ? normalizeChannelId(entry.lastChannel)
      : undefined;
  const senderProvider = delivery.channel !== "none" ? delivery.channel : lastChannel;
  const senderAllowFrom = senderProvider
    ? (getChannelPlugin(senderProvider)?.config.resolveAllowFrom?.({
        cfg,
        accountId: senderProvider === lastChannel ? entry?.lastAccountId : undefined,
      }) ?? [])
    : [];
  const sender = resolveHeartbeatSender({
    allowFrom: senderAllowFrom,
    lastTo: entry?.lastTo,
    provider: senderProvider,
  });
  const qmdHealth = await getQmdHealth();
  const qmdLine = qmdHealth.ok ? "QMD: OK" : `QMD: ERROR - ${qmdHealth.detail}`;
  const prompt = `${resolveHeartbeatPrompt(cfg)}\n\nSystem health:\n- ${qmdLine}\nIf any line is ERROR, include it verbatim in your reply.`;
  const ctx = {
    Body: prompt,
    From: sender,
    To: sender,
    Provider: "heartbeat",
  };

  try {
    const replyResult = await getReplyFromConfig(ctx, { isHeartbeat: true }, cfg);
    const replyPayload = resolveHeartbeatReplyPayload(replyResult);
    const includeReasoning = cfg.agents?.defaults?.heartbeat?.includeReasoning === true;
    const reasoningPayloads = includeReasoning
      ? resolveHeartbeatReasoningPayloads(replyResult).filter((payload) => payload !== replyPayload)
      : [];
    const sanitizedReasoningPayloads: ReplyPayload[] = [];
    for (const payload of reasoningPayloads) {
      const text = sanitizeHeartbeatText(payload.text);
      if (!text) continue;
      sanitizedReasoningPayloads.push({ ...payload, text });
    }

    if (
      !replyPayload ||
      (!replyPayload.text && !replyPayload.mediaUrl && !replyPayload.mediaUrls?.length)
    ) {
      await restoreHeartbeatUpdatedAt({
        storePath,
        sessionKey,
        updatedAt: previousUpdatedAt,
      });
      lastHeartbeatAtMs = startedAt;
      emitHeartbeatEvent({
        status: "ok-empty",
        reason: opts.reason,
        durationMs: Date.now() - startedAt,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }

    const ackMaxChars = resolveHeartbeatAckMaxChars(cfg);
    const normalized = normalizeHeartbeatReply(
      replyPayload,
      resolveEffectiveMessagesConfig(cfg, resolveAgentIdFromSessionKey(sessionKey)).responsePrefix,
      ackMaxChars,
    );
    const sanitizedMainText = sanitizeHeartbeatText(normalized.text);
    const shouldSkipMain = (normalized.shouldSkip || !sanitizedMainText) && !normalized.hasMedia;
    if (shouldSkipMain && sanitizedReasoningPayloads.length === 0) {
      await restoreHeartbeatUpdatedAt({
        storePath,
        sessionKey,
        updatedAt: previousUpdatedAt,
      });
      lastHeartbeatAtMs = startedAt;
      emitHeartbeatEvent({
        status: "ok-token",
        reason: opts.reason,
        durationMs: Date.now() - startedAt,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }

    const mediaUrls =
      replyPayload.mediaUrls ?? (replyPayload.mediaUrl ? [replyPayload.mediaUrl] : []);
    // Reasoning payloads are text-only; any attachments stay on the main reply.
    const previewText = shouldSkipMain
      ? sanitizedReasoningPayloads
          .map((payload) => payload.text)
          .filter((text): text is string => Boolean(text?.trim()))
          .join("\n")
      : sanitizedMainText;

    if (delivery.channel === "none" || !delivery.to) {
      lastHeartbeatAtMs = startedAt;
      emitHeartbeatEvent({
        status: "skipped",
        reason: delivery.reason ?? "no-target",
        preview: previewText?.slice(0, 200),
        durationMs: Date.now() - startedAt,
        hasMedia: mediaUrls.length > 0,
      });
      return { status: "ran", durationMs: Date.now() - startedAt };
    }

    const deliveryAccountId = delivery.channel === lastChannel ? entry?.lastAccountId : undefined;
    const heartbeatPlugin = getChannelPlugin(delivery.channel);
    if (heartbeatPlugin?.heartbeat?.checkReady) {
      const readiness = await heartbeatPlugin.heartbeat.checkReady({
        cfg,
        accountId: deliveryAccountId,
        deps: opts.deps,
      });
      if (!readiness.ok) {
        emitHeartbeatEvent({
          status: "skipped",
          reason: readiness.reason,
          preview: previewText?.slice(0, 200),
          durationMs: Date.now() - startedAt,
          hasMedia: mediaUrls.length > 0,
        });
        log.info("heartbeat: channel not ready", {
          channel: delivery.channel,
          reason: readiness.reason,
        });
        return { status: "skipped", reason: readiness.reason };
      }
    }

    await deliverOutboundPayloads({
      cfg,
      channel: delivery.channel,
      to: delivery.to,
      accountId: deliveryAccountId,
      payloads: [
        ...sanitizedReasoningPayloads,
        ...(shouldSkipMain
          ? []
          : [
              {
                text: sanitizedMainText,
                mediaUrls,
              },
            ]),
      ],
      deps: opts.deps,
    });

    lastHeartbeatAtMs = startedAt;
    emitHeartbeatEvent({
      status: "sent",
      to: delivery.to,
      preview: previewText?.slice(0, 200),
      durationMs: Date.now() - startedAt,
      hasMedia: mediaUrls.length > 0,
    });
    return { status: "ran", durationMs: Date.now() - startedAt };
  } catch (err) {
    const reason = formatErrorMessage(err);
    emitHeartbeatEvent({
      status: "failed",
      reason,
      durationMs: Date.now() - startedAt,
    });
    log.error(`heartbeat failed: ${reason}`, { error: reason });
    return { status: "failed", reason };
  }
}

export function startHeartbeatRunner(opts: {
  cfg?: SurprisebotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
}) {
  const cfg = opts.cfg ?? loadConfig();
  const intervalMs = resolveHeartbeatIntervalMs(cfg);
  if (!intervalMs) {
    log.info("heartbeat: disabled", { enabled: false });
  }

  const runtime = opts.runtime ?? defaultRuntime;
  const run = async (params?: { reason?: string }) => {
    const res = await runHeartbeatOnce({
      cfg,
      reason: params?.reason,
      deps: { runtime },
    });
    return res;
  };

  setHeartbeatWakeHandler(async (params) => run({ reason: params.reason }));

  let timer: NodeJS.Timeout | null = null;
  if (intervalMs) {
    timer = setInterval(() => {
      requestHeartbeatNow({ reason: "interval", coalesceMs: 0 });
    }, intervalMs);
    timer.unref?.();
    log.info("heartbeat: started", { intervalMs });
  }

  const cleanup = () => {
    setHeartbeatWakeHandler(null);
    if (timer) clearInterval(timer);
    timer = null;
  };

  opts.abortSignal?.addEventListener("abort", cleanup, { once: true });

  return { stop: cleanup };
}
