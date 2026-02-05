import { Type } from "@sinclair/typebox";

import type { SurprisebotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";
import {
  createTask,
  updateTaskStatus,
  addTaskMessage,
  addTaskSubscription,
} from "../../infra/mission-control/tasks.js";
import { listTasks, type MissionControlTaskStatus } from "../../infra/mission-control/db.js";
import { buildDailyStandup, buildWeeklyReport, buildHealthReport } from "../../infra/mission-control/reports.js";
import { runMissionControlMirror } from "../../infra/mission-control/mirror.js";

const TaskListSchema = Type.Object({
  status: Type.Optional(Type.String()),
  limit: Type.Optional(Type.Number()),
});

const TaskCreateSchema = Type.Object({
  title: Type.String(),
  description: Type.Optional(Type.String()),
  priority: Type.Optional(Type.String()),
  labels: Type.Optional(Type.Array(Type.String())),
  assignees: Type.Optional(Type.Array(Type.String())),
});

const TaskUpdateSchema = Type.Object({
  id: Type.String(),
  status: Type.Optional(Type.String()),
});

const TaskCommentSchema = Type.Object({
  taskId: Type.String(),
  content: Type.String(),
});

const ReportSchema = Type.Object({
  kind: Type.String(),
});

const MirrorSchema = Type.Object({});

function resolveCfg(options?: { config?: SurprisebotConfig }) {
  if (options?.config) return options.config;
  try {
    return loadConfig();
  } catch {
    return null;
  }
}

export function createMissionControlTaskListTool(options?: {
  config?: SurprisebotConfig;
}): AnyAgentTool {
  return {
    label: "Mission Control Tasks",
    name: "mission_control_task_list",
    description: "List mission control tasks from the local DB.",
    parameters: TaskListSchema,
    execute: async (_toolCallId, params) => {
      const cfg = resolveCfg(options);
      if (!cfg) return jsonResult({ error: "config unavailable" });
      const statusRaw = readStringParam(params, "status");
      const limit = readNumberParam(params, "limit", { integer: true }) ?? 20;
      const status = statusRaw ? (statusRaw as MissionControlTaskStatus) : undefined;
      const tasks = listTasks(cfg, { status, limit });
      return jsonResult({ tasks });
    },
  };
}

export function createMissionControlTaskCreateTool(options?: {
  config?: SurprisebotConfig;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Mission Control Task Create",
    name: "mission_control_task_create",
    description: "Create a mission control task (writes to DB + ledger).",
    parameters: TaskCreateSchema,
    execute: async (_toolCallId, params) => {
      const cfg = resolveCfg(options);
      if (!cfg) return jsonResult({ error: "config unavailable" });
      const title = readStringParam(params, "title", { required: true });
      const description = readStringParam(params, "description");
      const priority = readStringParam(params, "priority") as any;
      const labels = Array.isArray((params as any).labels) ? (params as any).labels : undefined;
      const assignees = Array.isArray((params as any).assignees) ? (params as any).assignees : undefined;
      const task = createTask(cfg, {
        title,
        description,
        priority,
        labels,
        assignees,
      });
      if (!task.ok) return jsonResult({ ok: false, existingId: task.existingId ?? null });
      return jsonResult({ ok: true, task: task.task });
    },
  };
}

export function createMissionControlTaskUpdateTool(options?: {
  config?: SurprisebotConfig;
}): AnyAgentTool {
  return {
    label: "Mission Control Task Update",
    name: "mission_control_task_update",
    description: "Update a mission control task status.",
    parameters: TaskUpdateSchema,
    execute: async (_toolCallId, params) => {
      const cfg = resolveCfg(options);
      if (!cfg) return jsonResult({ error: "config unavailable" });
      const id = readStringParam(params, "id", { required: true });
      const status = readStringParam(params, "status") as MissionControlTaskStatus | undefined;
      if (!status) return jsonResult({ error: "status required" });
      const res = updateTaskStatus(cfg, id, status);
      return jsonResult(res);
    },
  };
}

export function createMissionControlTaskCommentTool(options?: {
  config?: SurprisebotConfig;
  agentSessionKey?: string;
}): AnyAgentTool {
  return {
    label: "Mission Control Task Comment",
    name: "mission_control_task_comment",
    description: "Add a task comment/message.",
    parameters: TaskCommentSchema,
    execute: async (_toolCallId, params) => {
      const cfg = resolveCfg(options);
      if (!cfg) return jsonResult({ error: "config unavailable" });
      const taskId = readStringParam(params, "taskId", { required: true });
      const content = readStringParam(params, "content", { required: true });
      const authorId = resolveSessionAgentId({ sessionKey: options?.agentSessionKey, config: cfg }) ?? undefined;
      const record = addTaskMessage(cfg, { taskId, content, authorId });
      if (authorId) {
        addTaskSubscription(cfg, taskId, authorId, "commented");
      }
      return jsonResult({ ok: true, message: record });
    },
  };
}

export function createMissionControlReportTool(options?: {
  config?: SurprisebotConfig;
}): AnyAgentTool {
  return {
    label: "Mission Control Report",
    name: "mission_control_report",
    description: "Generate daily/weekly/health reports from Mission Control.",
    parameters: ReportSchema,
    execute: async (_toolCallId, params) => {
      const cfg = resolveCfg(options);
      if (!cfg) return jsonResult({ error: "config unavailable" });
      const kind = readStringParam(params, "kind", { required: true }).toLowerCase();
      let text = "";
      if (kind === "daily") text = await buildDailyStandup(cfg);
      else if (kind === "weekly") text = await buildWeeklyReport(cfg);
      else if (kind === "health") text = await buildHealthReport(cfg);
      else return jsonResult({ error: "unknown report kind" });
      return jsonResult({ text });
    },
  };
}

export function createMissionControlMirrorTool(options?: {
  config?: SurprisebotConfig;
}): AnyAgentTool {
  return {
    label: "Mission Control Mirror",
    name: "mission_control_mirror",
    description: "Run Mission Control mirror to configured sinks.",
    parameters: MirrorSchema,
    execute: async () => {
      const cfg = resolveCfg(options);
      if (!cfg) return jsonResult({ error: "config unavailable" });
      const res = await runMissionControlMirror(cfg);
      return jsonResult(res);
    },
  };
}
