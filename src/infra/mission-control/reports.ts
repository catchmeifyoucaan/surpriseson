import type { SurprisebotConfig } from "../../config/config.js";
import { listTasks } from "./db.js";
import { readMissionControlRecords, type RunLedgerRecord } from "./ledger.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtList(items: string[], limit = 8) {
  if (items.length === 0) return "(none)";
  return items.slice(0, limit).map((item) => `- ${item}`).join("\n");
}

export async function buildDailyStandup(cfg: SurprisebotConfig): Promise<string> {
  const now = Date.now();
  const since = now - DAY_MS;
  const tasks = listTasks(cfg, { limit: 500 });
  const completed = tasks.filter((t) =>
    ["done", "verified"].includes(t.status) && Date.parse(t.updatedAt) >= since,
  );
  const inProgress = tasks.filter((t) => ["in_progress", "assigned"].includes(t.status));
  const blocked = tasks.filter((t) => t.status === "blocked");
  const keyFindings = tasks.filter((t) =>
    (t.labels ?? []).includes("exposure") || t.priority === "critical" || t.severity === "high",
  );

  return [
    "DAILY STANDUP",
    "\n✅ COMPLETED (24h)",
    fmtList(completed.map((t) => `${t.title} (${t.priority})`)),
    "\n🔄 IN PROGRESS",
    fmtList(inProgress.map((t) => `${t.title} (${t.priority})`)),
    "\n🚫 BLOCKED",
    fmtList(blocked.map((t) => `${t.title}`)),
    "\n🔎 TOP FINDINGS",
    fmtList(keyFindings.slice(0, 5).map((t) => `${t.title} (${t.severity ?? "n/a"})`)),
  ].join("\n");
}

export async function buildWeeklyReport(cfg: SurprisebotConfig): Promise<string> {
  const now = Date.now();
  const since = now - 7 * DAY_MS;
  const tasks = listTasks(cfg, { limit: 800 });
  const completed = tasks.filter((t) =>
    ["done", "verified"].includes(t.status) && Date.parse(t.updatedAt) >= since,
  );
  const findings = tasks.filter((t) => (t.labels ?? []).includes("exposure"));
  const highPriority = tasks.filter((t) => ["high", "critical"].includes(t.priority));

  return [
    "WEEKLY DEEP REPORT",
    "\n✅ COMPLETED (7d)",
    fmtList(completed.map((t) => `${t.title} (${t.priority})`), 12),
    "\n🚨 HIGH PRIORITY",
    fmtList(highPriority.map((t) => `${t.title}`), 10),
    "\n🔎 EXPOSURES",
    fmtList(findings.map((t) => `${t.title}`), 10),
  ].join("\n");
}

export async function buildHealthReport(cfg: SurprisebotConfig): Promise<string> {
  const now = Date.now();
  const since = now - DAY_MS;
  const tasks = listTasks(cfg, { limit: 500 });
  const statusCounts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});
  const runs = await readMissionControlRecords<RunLedgerRecord>({
    cfg,
    kind: "run-ledger",
    sinceMs: since,
  });
  const totalRuns = runs.length;
  const failedRuns = runs.filter((r) => r.status === "failed").length;

  return [
    "HEALTH DASHBOARD (24h)",
    `\nTasks: ${Object.entries(statusCounts)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ")}`,
    `Runs: ${totalRuns} (failed: ${failedRuns})`,
  ].join("\n");
}
