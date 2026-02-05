import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { SurprisebotConfig } from "../../config/config.js";
import { buildSubagentSystemPrompt } from "../../agents/subagent-announce.js";
import { AGENT_LANE_SUBAGENT } from "../../agents/lanes.js";
import { registerSubagentRun } from "../../agents/subagent-registry.js";
import {
  resolveDisplaySessionKey,
  resolveInternalSessionKey,
  resolveMainSessionAlias,
} from "../../agents/tools/sessions-helpers.js";
import { callGateway } from "../../gateway/call.js";
import { evaluateBudget } from "../budget-manager.js";
import { appendMissionControlRecord } from "../mission-control/ledger.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import type { IncidentRecord } from "../incidents.js";

export type OrchestratorDispatchRecord = {
  id: string;
  ts: string;
  incidentId: string;
  ruleId?: string;
  agentId?: string;
  status: "accepted" | "skipped" | "error";
  task?: string;
  error?: string;
  runId?: string;
  childSessionKey?: string;
};

function getOrchestratorConfig(cfg: SurprisebotConfig) {
  return cfg.agents?.defaults?.orchestrator;
}

function normalizeList(values?: string[]): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function matchesRule(rule: {
  sources?: string[];
  severities?: Array<"low" | "medium" | "high">;
  summaryContains?: string[];
}, incident: IncidentRecord): boolean {
  const sources = normalizeList(rule.sources);
  if (sources.length > 0 && !sources.includes(incident.source)) return false;
  const severities = rule.severities ?? [];
  if (severities.length > 0 && !severities.includes(incident.severity)) return false;
  const summaryContains = normalizeList(rule.summaryContains).map((val) => val.toLowerCase());
  if (summaryContains.length > 0) {
    const summary = incident.summary?.toLowerCase() ?? "";
    if (!summaryContains.some((token) => summary.includes(token))) return false;
  }
  return true;
}

function renderTemplate(template: string, incident: IncidentRecord): string {
  const evidence = Array.isArray(incident.evidence) ? incident.evidence.join("\n") : "";
  const meta = incident.meta ? JSON.stringify(incident.meta, null, 2) : "";
  return template
    .replace(/{{\s*summary\s*}}/g, incident.summary ?? "")
    .replace(/{{\s*source\s*}}/g, incident.source ?? "")
    .replace(/{{\s*severity\s*}}/g, incident.severity ?? "")
    .replace(/{{\s*evidence\s*}}/g, evidence)
    .replace(/{{\s*meta\s*}}/g, meta)
    .replace(/{{\s*id\s*}}/g, incident.id ?? "")
    .replace(/{{\s*ts\s*}}/g, incident.ts ?? "");
}

async function appendDispatchRecord(dispatchPath: string, record: OrchestratorDispatchRecord) {
  await fs.mkdir(path.dirname(dispatchPath), { recursive: true });
  await fs.appendFile(dispatchPath, `${JSON.stringify(record)}\n`);
}

export async function dispatchIncidents(params: {
  cfg: SurprisebotConfig;
  incidents: IncidentRecord[];
  workspaceDir: string;
  dispatchPath: string;
}): Promise<void> {
  const orchestrator = getOrchestratorConfig(params.cfg);
  const routing = orchestrator?.routing ?? [];
  const explicitDefault = orchestrator?.defaultAgentId?.trim();
  const hasExplicitDefault = Boolean(explicitDefault);
  const defaultAgentId = hasExplicitDefault ? explicitDefault : undefined;

  if (routing.length === 0 && !defaultAgentId) {
    for (const incident of params.incidents) {
      await appendDispatchRecord(params.dispatchPath, {
        id: `dispatch-${crypto.randomUUID()}`,
        ts: new Date().toISOString(),
        incidentId: incident.id,
        status: "skipped",
        error: "no routing rules",
      });
    }
    return;
  }

  const { mainKey, alias } = resolveMainSessionAlias(params.cfg);
  const requesterSessionKey = resolveInternalSessionKey({ key: alias, alias, mainKey });
  const requesterDisplayKey = resolveDisplaySessionKey({ key: requesterSessionKey, alias, mainKey });

  for (const incident of params.incidents) {
    const rule = routing.find((candidate) => matchesRule(candidate, incident));
    const targetAgentId = rule?.agentId ?? defaultAgentId;
    if (!targetAgentId) {
      await appendDispatchRecord(params.dispatchPath, {
        id: `dispatch-${crypto.randomUUID()}`,
        ts: new Date().toISOString(),
        incidentId: incident.id,
        ruleId: rule?.id,
        status: "skipped",
        error: "no agent id",
      });
      continue;
    }
    const agentId = normalizeAgentId(targetAgentId);

    const taskTemplate = rule?.taskTemplate?.trim();
    const jobType = (rule?.jobType ?? incident.source ?? "incident").trim();
    const budgetDecision = await evaluateBudget({
      cfg: params.cfg,
      agentId,
      jobType,
      incidentId: incident.id,
    });
    if (budgetDecision.decision === "deny" || budgetDecision.decision === "defer") {
      await appendDispatchRecord(params.dispatchPath, {
        id: `dispatch-${crypto.randomUUID()}`,
        ts: new Date().toISOString(),
        incidentId: incident.id,
        ruleId: rule?.id,
        agentId,
        status: "skipped",
        task: `Budget ${budgetDecision.decision}: ${budgetDecision.reason}`,
        error: `budget_${budgetDecision.decision}:${budgetDecision.reason}`,
      });
      continue;
    }
    const task = taskTemplate
      ? renderTemplate(taskTemplate, incident)
      : `Incident ${incident.id} (${incident.severity}): ${incident.summary}`;

    const childSessionKey = `agent:${agentId}:subagent:${crypto.randomUUID()}`;
    const childSystemPrompt = buildSubagentSystemPrompt({
      requesterSessionKey,
      childSessionKey,
      label: rule?.id ?? `incident:${incident.id}`,
      task,
    });

    const idempotencyKey = crypto.randomUUID();
    let runId: string = idempotencyKey;

    try {
      const response = (await callGateway({
        method: "agent",
        params: {
          message: task,
          sessionKey: childSessionKey,
          deliver: false,
          lane: AGENT_LANE_SUBAGENT,
          extraSystemPrompt: childSystemPrompt,
          label: rule?.id ?? `incident:${incident.id}`,
          spawnedBy: requesterSessionKey,
          idempotencyKey,
        },
        timeoutMs: 10_000,
      })) as { runId?: string };

      if (typeof response?.runId === "string" && response.runId) {
        runId = response.runId;
      }

      registerSubagentRun({
        runId,
        childSessionKey,
        requesterSessionKey,
        requesterDisplayKey,
        task,
        cleanup: "keep",
        label: rule?.id ?? `incident:${incident.id}`,
      });

      await appendMissionControlRecord({
        cfg: params.cfg,
        kind: "run-ledger",
        record: {
          id: `run-${runId}`,
          ts: new Date().toISOString(),
          source: "system",
          version: 1,
          taskId: `incident:${incident.id}`,
          agentId,
          status: "running",
          command: "orchestrator-dispatch",
          startedAt: new Date().toISOString(),
          jobType,
          meta: {
            incidentId: incident.id,
            ruleId: rule?.id,
            childSessionKey,
          },
        },
      });


      await appendDispatchRecord(params.dispatchPath, {
        id: `dispatch-${crypto.randomUUID()}`,
        ts: new Date().toISOString(),
        incidentId: incident.id,
        ruleId: rule?.id,
        agentId,
        status: "accepted",
        task,
        runId,
        childSessionKey,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await appendDispatchRecord(params.dispatchPath, {
        id: `dispatch-${crypto.randomUUID()}`,
        ts: new Date().toISOString(),
        incidentId: incident.id,
        ruleId: rule?.id,
        agentId,
        status: "error",
        task,
        error: message,
      });
    }
  }
}
