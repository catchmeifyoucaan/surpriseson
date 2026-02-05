import { resolveHeartbeatDeliveryTarget } from "./outbound/targets.js";
import type { SurprisebotConfig } from "../config/config.js";
import type { ReplyPayload } from "../auto-reply/types.js";

const ALERT_FIELDS = ["Summary:", "Evidence:", "Next action:"];

function hasAlertFormat(text: string): boolean {
  const lower = text.toLowerCase();
  return ALERT_FIELDS.every((field) => lower.includes(field.toLowerCase()));
}

function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match?.[0] ?? null;
}

function extractLineByPrefix(text: string, prefixes: string[]): string | null {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();
    for (const prefix of prefixes) {
      if (lower.startsWith(prefix)) {
        return trimmed.slice(prefix.length).trim() || null;
      }
    }
  }
  return null;
}

function compactSummary(text: string): string {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim())?.trim() ?? "";
  const cleaned = firstLine || text.trim();
  if (!cleaned) return "No summary provided.";
  return cleaned.length > 200 ? `${cleaned.slice(0, 197)}...` : cleaned;
}

export function formatAlertText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "Summary: (empty)\nEvidence: (none)\nNext action: Review and decide.";
  }
  if (hasAlertFormat(trimmed)) return trimmed;

  const summary = compactSummary(trimmed);
  const evidence =
    extractLineByPrefix(trimmed, ["evidence:", "proof:", "logs:", "log:"]) ??
    extractFirstUrl(trimmed) ??
    "See details.";
  const nextAction =
    extractLineByPrefix(trimmed, ["next action:", "next:", "action:", "todo:"]) ??
    "Review and decide.";

  const details = trimmed.length > 0 ? `\n\nDetails:\n${trimmed}` : "";
  return `Summary: ${summary}\nEvidence: ${evidence}\nNext action: ${nextAction}${details}`;
}

export function formatAlertPayloads(payloads: ReplyPayload[]): ReplyPayload[] {
  return payloads.map((payload) => {
    if (!payload.text || !payload.text.trim()) return payload;
    return { ...payload, text: formatAlertText(payload.text) };
  });
}

export function isCriticalAlertTarget(params: {
  cfg: SurprisebotConfig;
  channel: string;
  to: string;
}): boolean {
  const heartbeatTarget = resolveHeartbeatDeliveryTarget({ cfg: params.cfg });
  if (heartbeatTarget.channel === "none") return false;
  if (!heartbeatTarget.to) return false;
  return heartbeatTarget.channel === params.channel && heartbeatTarget.to === params.to;
}
