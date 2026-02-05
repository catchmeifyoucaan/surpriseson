import crypto from "node:crypto";

import type { SurprisebotConfig } from "../../config/config.js";
import type { IncidentRecord, IncidentSeverity } from "../incidents.js";
import { resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { createSubsystemLogger } from "../../logging.js";
import { createTask, addTaskActivity, addTaskSubscription } from "./tasks.js";

const log = createSubsystemLogger("gateway/mission-control-incidents");

function severityRank(sev: IncidentSeverity): number {
  if (sev === "high") return 3;
  if (sev === "medium") return 2;
  return 1;
}

function resolveIncidentMinSeverity(cfg: SurprisebotConfig): IncidentSeverity {
  return cfg.missionControl?.incidents?.minSeverity ?? "medium";
}

function resolveIncidentPriority(cfg: SurprisebotConfig, severity: IncidentSeverity) {
  return (
    cfg.missionControl?.incidents?.defaultPriority ??
    (severity === "high" ? "high" : severity === "medium" ? "medium" : "low")
  );
}

function resolveTrustTier(cfg: SurprisebotConfig, incident: IncidentRecord) {
  const trust = cfg.missionControl?.trust;
  const source = incident.source ?? "";
  if (trust?.quarantineSources?.includes(source)) return "quarantine" as const;
  if (trust?.bySource?.[source]) return trust.bySource[source];
  return trust?.defaultTier ?? "unverified";
}

function resolveMinEvidenceCount(cfg: SurprisebotConfig): number {
  const value = cfg.missionControl?.alerts?.minEvidenceCount;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, value) : 1;
}

function hasUrlEvidence(incident: IncidentRecord): boolean {
  const metaUrl = incident.meta && typeof incident.meta === "object" ? (incident.meta as Record<string, unknown>).url : undefined;
  const url = typeof metaUrl === "string" ? metaUrl.trim() : "";
  if (url) return true;
  const evidence = Array.isArray(incident.evidence) ? incident.evidence : [];
  return evidence.some((line) => /^(url:\s*https?:\/\/|https?:\/\/)/i.test(String(line).trim()));
}

function resolveAssignee(cfg: SurprisebotConfig, incident: IncidentRecord): string | null {
  const routing = cfg.agents?.defaults?.orchestrator?.routing ?? [];
  const rule = routing.find((candidate) => {
    const sources = candidate.sources ?? [];
    if (sources.length > 0 && !sources.includes(incident.source)) return false;
    const severities = candidate.severities ?? [];
    if (severities.length > 0 && !severities.includes(incident.severity)) return false;
    return true;
  });
  const target = rule?.agentId?.trim();
  if (target) return normalizeAgentId(target);
  const fallback = resolveDefaultAgentId(cfg);
  return fallback ? normalizeAgentId(fallback) : null;
}

function shouldRequireQa(cfg: SurprisebotConfig, incident: IncidentRecord, trustTier: string) {
  const qa = cfg.missionControl?.qa;
  if (!qa) return false;
  if (qa.requiredSeverities?.includes(incident.severity)) return true;
  if (qa.requiredTrustTiers?.includes(trustTier as any)) return true;
  return false;
}

export function evaluateIncidentQa(cfg: SurprisebotConfig, incident: IncidentRecord): { trustTier: "trusted" | "unverified" | "quarantine"; qaRequired: boolean } {
  const trustTier = resolveTrustTier(cfg, incident);
  const qaRequired = shouldRequireQa(cfg, incident, trustTier);
  return { trustTier, qaRequired };
}


function buildFingerprint(incident: IncidentRecord): string {
  const payload = [incident.source, incident.severity, incident.summary, ...(incident.evidence ?? [])]
    .filter(Boolean)
    .join("\n");
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function maybeCreateTaskFromIncident(cfg: SurprisebotConfig, incident: IncidentRecord) {
  if (cfg.missionControl?.killSwitch) return { ok: false, skipped: true } as const;
  const minSeverity = resolveIncidentMinSeverity(cfg);
  const minEvidenceCount = resolveMinEvidenceCount(cfg);
  const evidenceCount = Array.isArray(incident.evidence) ? incident.evidence.length : 0;
  const requiresEvidence = incident.source === "research" || incident.source === "exposure";
  const eligibleForTask = !requiresEvidence || (hasUrlEvidence(incident) && evidenceCount >= minEvidenceCount);
  if (!eligibleForTask) return { ok: false, skipped: true } as const;
  if (severityRank(incident.severity) < severityRank(minSeverity)) return { ok: false, skipped: true } as const;

  const { trustTier, qaRequired } = evaluateIncidentQa(cfg, incident);
  const qaAgentId = cfg.missionControl?.qa?.agentId?.trim();
  const meta = incident.meta && typeof incident.meta === "object" ? (incident.meta as Record<string, unknown>) : {};
  const runId = typeof meta.runId === "string" ? meta.runId : null;
  const defaultAssignee = resolveAssignee(cfg, incident);
  const assignees = qaRequired && qaAgentId ? [normalizeAgentId(qaAgentId)] : defaultAssignee ? [defaultAssignee] : [];

  const task = createTask(cfg, {
    title: incident.summary,
    description: incident.evidence?.join("\n"),
    status: qaRequired ? "review" : "assigned",
    priority: resolveIncidentPriority(cfg, incident.severity),
    source: incident.source,
    severity: incident.severity,
    trustTier,
    fingerprint: buildFingerprint(incident),
    assignees,
    labels: ["incident", incident.source].filter(Boolean) as string[],
    meta: { incidentId: incident.id, ...(runId ? { runId } : {}) },
  });

  if (!task.ok && task.existingId) {
    addTaskActivity(cfg, {
      taskId: task.existingId,
      type: "incident_dedupe",
      message: `Incident ${incident.id} deduped against existing task ${task.existingId}`,
      meta: { incidentId: incident.id, ...(runId ? { runId } : {}) },
    });
    return { ok: true, deduped: true, taskId: task.existingId } as const;
  }

  if (!task.ok || !task.task) {
    log.warn("incident task creation failed", { incidentId: incident.id });
    return { ok: false } as const;
  }

  for (const agentId of assignees) {
    addTaskSubscription(cfg, task.task.id, agentId, qaRequired ? "qa" : "assigned");
  }
  addTaskActivity(cfg, {
    taskId: task.task.id,
    type: "task_created",
    message: `Task created from incident ${incident.id}`,
    meta: { incidentId: incident.id, ...(runId ? { runId } : {}) },
  });

  return { ok: true, taskId: task.task.id } as const;
}
