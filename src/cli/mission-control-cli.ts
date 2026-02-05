import type { Command } from "commander";

import { loadConfig } from "../config/config.js";
import { defaultRuntime } from "../runtime.js";
import { createTask, updateTaskStatus } from "../infra/mission-control/tasks.js";
import { listTasks, type MissionControlTaskStatus } from "../infra/mission-control/db.js";
import { buildDailyStandup, buildWeeklyReport, buildHealthReport } from "../infra/mission-control/reports.js";
import { runMissionControlMirror } from "../infra/mission-control/mirror.js";
import { pruneMissionControlDuplicates } from "../infra/mission-control/maintenance.js";

export function registerMissionControlCli(program: Command) {
  const mc = program.command("mission-control").description("Mission Control tools");

  mc
    .command("task:list")
    .description("List tasks")
    .option("--status <status>")
    .option("--limit <n>", "Max results", (v) => Number(v))
    .action((opts) => {
      const cfg = loadConfig();
      const tasks = listTasks(cfg, {
        status: opts.status as MissionControlTaskStatus | undefined,
        limit: opts.limit,
      });
      defaultRuntime.log(JSON.stringify({ tasks }, null, 2));
    });

  mc
    .command("task:create")
    .description("Create task")
    .requiredOption("--title <title>")
    .option("--description <text>")
    .option("--priority <level>")
    .action((opts) => {
      const cfg = loadConfig();
      const res = createTask(cfg, {
        title: opts.title,
        description: opts.description,
        priority: opts.priority,
      });
      defaultRuntime.log(JSON.stringify(res, null, 2));
    });

  mc
    .command("task:update")
    .description("Update task status")
    .requiredOption("--id <id>")
    .requiredOption("--status <status>")
    .action((opts) => {
      const cfg = loadConfig();
      const res = updateTaskStatus(cfg, opts.id, opts.status as MissionControlTaskStatus);
      defaultRuntime.log(JSON.stringify(res, null, 2));
    });

  mc
    .command("mirror")
    .description("Mirror Mission Control snapshot to configured sinks")
    .action(async () => {
      const cfg = loadConfig();
      const res = await runMissionControlMirror(cfg);
      defaultRuntime.log(JSON.stringify(res, null, 2));
    });

  mc
    .command("report")
    .description("Generate Mission Control report")
    .requiredOption("--kind <daily|weekly|health>")
    .action(async (opts) => {
      const cfg = loadConfig();
      const kind = String(opts.kind).toLowerCase();
      let text = "";
      if (kind === "daily") text = await buildDailyStandup(cfg);
      else if (kind === "weekly") text = await buildWeeklyReport(cfg);
      else if (kind === "health") text = await buildHealthReport(cfg);
      else throw new Error("unknown report kind");
      defaultRuntime.log(text);
    });

  mc
    .command("maintenance")
    .description("Prune duplicate mission-control entries")
    .action(async () => {
      const cfg = loadConfig();
      const res = await pruneMissionControlDuplicates(cfg);
      defaultRuntime.log(JSON.stringify(res, null, 2));
    });
}
