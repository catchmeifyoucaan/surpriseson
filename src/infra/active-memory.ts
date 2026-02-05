import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_ACTIVE = [
  "Current goals:",
  "- None",
  "",
  "Running jobs:",
  "- None",
  "",
  "Blockers:",
  "- None",
  "",
].join("\n");

export type RunningJobSpec =
  | { kind: "recon"; pid?: number; logPath?: string }
  | {
      kind: "subagent";
      agentId?: string;
      label?: string;
      runId?: string;
      task?: string;
    };

const PREFIX_BY_KIND = {
  recon: "- recon/run.sh",
  subagent: "- subagent:",
} as const;

function normalizeHeader(line: string) {
  return line.trim().toLowerCase();
}

function findHeaderIndex(lines: string[], header: string): number {
  const target = header.trim().toLowerCase();
  return lines.findIndex((line) => normalizeHeader(line) === target);
}

function isSectionHeader(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("-")) return false;
  return trimmed.endsWith(":");
}

function normalizeActiveMemory(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  const out: string[] = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (out.length === 0 || out[out.length - 1] === "") continue;
      out.push("");
      continue;
    }
    if (isSectionHeader(line) && out.length > 0 && out[out.length - 1] !== "") {
      out.push("");
    }
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n").trimEnd() + "\n";
}

function findSectionEnd(lines: string[], startIndex: number): number {
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (isSectionHeader(lines[i])) return i;
  }
  return lines.length;
}

function buildReconJobLine(params: { pid?: number; logPath?: string; useUnicodeArrow: boolean }) {
  const arrow = params.useUnicodeArrow ? "→" : "->";
  const pidPart = typeof params.pid === "number" ? ` (PID ${params.pid})` : "";
  const logPart = params.logPath ? ` ${arrow} ${params.logPath}` : "";
  return `${PREFIX_BY_KIND.recon}${pidPart}${logPart}`.trimEnd();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function buildSubagentJobLine(params: {
  agentId?: string;
  label?: string;
  runId?: string;
  task?: string;
  useUnicodeArrow: boolean;
}) {
  const arrow = params.useUnicodeArrow ? "→" : "->";
  const agentPart = params.agentId ? `subagent:${params.agentId}` : "subagent";
  const labelPart = params.label ? ` ${params.label}` : "";
  const runPart = params.runId ? ` (runId ${params.runId.slice(0, 8)})` : "";
  const task = params.task ? truncate(params.task, 120) : "";
  const taskPart = task ? ` ${arrow} ${task}` : "";
  return `- ${agentPart}${labelPart}${runPart}${taskPart}`.trimEnd();
}

function buildManagedJobLines(params: { jobs: RunningJobSpec[]; useUnicodeArrow: boolean }) {
  const lines: string[] = [];
  for (const job of params.jobs) {
    if (job.kind === "recon") {
      lines.push(
        buildReconJobLine({ pid: job.pid, logPath: job.logPath, useUnicodeArrow: params.useUnicodeArrow }),
      );
    } else if (job.kind === "subagent") {
      lines.push(
        buildSubagentJobLine({
          agentId: job.agentId,
          label: job.label,
          runId: job.runId,
          task: job.task,
          useUnicodeArrow: params.useUnicodeArrow,
        }),
      );
    }
  }
  return lines;
}

function updateRunningJobsSection(params: {
  content: string;
  jobs: RunningJobSpec[];
  managedPrefixes: string[];
}): { text: string; changed: boolean } {
  const useUnicodeArrow = params.content.includes("→");
  const lines = params.content.split(/\r?\n/);
  let runningIdx = findHeaderIndex(lines, "Running jobs:");
  let blockersIdx = findHeaderIndex(lines, "Blockers:");

  if (runningIdx === -1) {
    const insertAt = blockersIdx >= 0 ? blockersIdx : lines.length;
    const insertLines = ["", "Running jobs:", "- None", ""];
    lines.splice(insertAt, 0, ...insertLines);
    runningIdx = findHeaderIndex(lines, "Running jobs:");
    blockersIdx = findHeaderIndex(lines, "Blockers:");
  }

  if (blockersIdx === -1) {
    lines.push("", "Blockers:", "- None", "");
    blockersIdx = findHeaderIndex(lines, "Blockers:");
  }

  if (runningIdx === -1) {
    return { text: params.content, changed: false };
  }

  const sectionEnd = findSectionEnd(lines, runningIdx);
  const existing = lines.slice(runningIdx + 1, sectionEnd).filter((line) => line.trim() !== "");
  const filtered = existing.filter((line) => {
    const trimmed = line.trimStart();
    return !params.managedPrefixes.some((prefix) => trimmed.startsWith(prefix));
  });

  let next = filtered.filter((line) => line.trim() !== "- None");
  const managed = buildManagedJobLines({ jobs: params.jobs, useUnicodeArrow });
  if (managed.length > 0) {
    next = [...next, ...managed];
  }
  if (next.length === 0) next = ["- None"];

  const updatedLines = [...lines.slice(0, runningIdx + 1), ...next, ...lines.slice(sectionEnd)];
  const nextText = normalizeActiveMemory(updatedLines.join("\n"));
  return { text: nextText, changed: nextText !== params.content };
}

export async function syncActiveMemoryRunningJob(params: {
  workspaceDir: string;
  running: boolean;
  pid?: number;
  logPath?: string;
}) {
  const jobs: RunningJobSpec[] = params.running
    ? [{ kind: "recon", pid: params.pid, logPath: params.logPath }]
    : [];
  await syncActiveMemoryRunningJobs({
    workspaceDir: params.workspaceDir,
    jobs,
    managedPrefixes: [PREFIX_BY_KIND.recon],
  });
}

export async function syncActiveMemoryRunningJobs(params: {
  workspaceDir: string;
  jobs: RunningJobSpec[];
  managedPrefixes?: string[];
}) {
  const memoryDir = path.join(params.workspaceDir, "memory");
  const activePath = path.join(memoryDir, "active.md");
  await fs.mkdir(memoryDir, { recursive: true });

  let content = DEFAULT_ACTIVE;
  try {
    content = await fs.readFile(activePath, "utf8");
  } catch {
    // use default template
  }

  const managedPrefixes = params.managedPrefixes ?? Object.values(PREFIX_BY_KIND);
  const { text, changed } = updateRunningJobsSection({
    content,
    jobs: params.jobs,
    managedPrefixes,
  });
  if (!changed) return;
  await fs.writeFile(activePath, text);
}
