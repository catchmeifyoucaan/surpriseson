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
import { normalizeAgentId } from "../../routing/session-key.js";
import { evaluateBudget } from "../budget-manager.js";
import { appendMissionControlRecord } from "../mission-control/ledger.js";
import { listTasks, getTask } from "../mission-control/db.js";
import { updateTaskStatus, addTaskActivity } from "../mission-control/tasks.js";

export type TaskDispatchRecord = {
  id: string;
  ts: string;
  taskId: string;
  agentId?: string;
  status: "accepted" | "skipped" | "error";
  error?: string;
  runId?: string;
  childSessionKey?: string;
};

async function appendDispatchRecord(dispatchPath: string, record: TaskDispatchRecord) {
  await fs.mkdir(path.dirname(dispatchPath), { recursive: true });
  await fs.appendFile(dispatchPath, `${JSON.stringify(record)}\n`);
}

export async function dispatchTasks(params: {
  cfg: SurprisebotConfig;
  workspaceDir: string;
  dispatchPath: string;
}) {
  const tasks = [
    ...listTasks(params.cfg, { status: "assigned", limit: 50 }),
    ...listTasks(params.cfg, { status: "inbox", limit: 25 }),
  ];
  if (tasks.length === 0) return;

  const { mainKey, alias } = resolveMainSessionAlias(params.cfg);
  const requesterSessionKey = resolveInternalSessionKey({ key: alias, alias, mainKey });
  const requesterDisplayKey = resolveDisplaySessionKey({ key: requesterSessionKey, alias, mainKey });

  for (const task of tasks) {
    const assignee = (task.assignees ?? [])[0];
    const targetAgentId = assignee ? normalizeAgentId(assignee) : undefined;
    if (!targetAgentId) {
      await appendDispatchRecord(params.dispatchPath, {
        id: `task-dispatch-${crypto.randomUUID()}`,
        ts: new Date().toISOString(),
        taskId: task.id,
        status: "skipped",
        error: "no assignee",
      });
      continue;
    }

    const budgetDecision = await evaluateBudget({
      cfg: params.cfg,
      agentId: targetAgentId,
      jobType: "task",
      runId: task.id,
    });
    if (budgetDecision.decision === "deny" || budgetDecision.decision === "defer") {
      await appendDispatchRecord(params.dispatchPath, {
        id: `task-dispatch-${crypto.randomUUID()}`,
        ts: new Date().toISOString(),
        taskId: task.id,
        agentId: targetAgentId,
        status: "skipped",
        error: `budget_${budgetDecision.decision}:${budgetDecision.reason}`,
      });
      continue;
    }

    const taskText = task.description
      ? `${task.title}\n\n${task.description}`
      : task.title;
    const childSessionKey = `agent:${targetAgentId}:subagent:${crypto.randomUUID()}`;
    const childSystemPrompt = buildSubagentSystemPrompt({
      requesterSessionKey,
      childSessionKey,
      label: `task:${task.id}`,
      task: taskText,
    });

    const idempotencyKey = crypto.randomUUID();
    let runId: string = idempotencyKey;

    try {
      const response = (await callGateway({
        method: "agent",
        params: {
          message: taskText,
          sessionKey: childSessionKey,
          deliver: false,
          lane: AGENT_LANE_SUBAGENT,
          extraSystemPrompt: childSystemPrompt,
          label: `task:${task.id}`,
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
        task: taskText,
        cleanup: "keep",
        label: `task:${task.id}`,
      });

      updateTaskStatus(params.cfg, task.id, "in_progress");
      addTaskActivity(params.cfg, {
        taskId: task.id,
        type: "task_dispatched",
        message: `Dispatched to ${targetAgentId}`,
        meta: { runId },
      });

      await appendMissionControlRecord({
        cfg: params.cfg,
        kind: "run-ledger",
        record: {
          id: `run-${runId}`,
          ts: new Date().toISOString(),
          source: "system",
          version: 1,
          taskId: task.id,
          agentId: targetAgentId,
          status: "running",
          command: "task-dispatch",
          startedAt: new Date().toISOString(),
          jobType: "task",
          meta: { taskId: task.id },
        } as any,
      });

      await appendDispatchRecord(params.dispatchPath, {
        id: `task-dispatch-${crypto.randomUUID()}`,
        ts: new Date().toISOString(),
        taskId: task.id,
        agentId: targetAgentId,
        status: "accepted",
        runId,
        childSessionKey,
      });
    } catch (err) {
      await appendDispatchRecord(params.dispatchPath, {
        id: `task-dispatch-${crypto.randomUUID()}`,
        ts: new Date().toISOString(),
        taskId: task.id,
        agentId: targetAgentId,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
