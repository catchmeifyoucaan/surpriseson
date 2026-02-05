import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import type { SurprisebotConfig } from "../config/config.js";
import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import { createSubsystemLogger } from "../logging.js";
import { evaluateBudget } from "./budget-manager.js";
import { appendMissionControlRecord } from "./mission-control/ledger.js";
import { runStanfordArtemis, resolveDefaultArtemisDir } from "./artemis/runner.js";
import { ingestArtemisOutputs } from "./artemis/ingest.js";
import { syncStanfordArtifacts } from "./artemis/sync.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { loadLatestArtemisMetrics } from "./artemis/metrics.js";

const log = createSubsystemLogger("gateway/artemis");

type ArtemisRunnerState = {
  lastStanfordRunAt?: number;
  lastStanfordRunId?: string;
  stanfordRunning?: boolean;
  lastStanfordExitCode?: number | null;
  lastStanfordSessionDir?: string;
  lastCertRunAt?: number;
  lastCertRunId?: string;
  lastCertExitCode?: number | null;
  lastCertLogPath?: string;
  certRunning?: boolean;
};

function resolveWorkspaceDir(cfg: SurprisebotConfig): string {
  const agentId = resolveDefaultAgentId(cfg);
  return resolveAgentWorkspaceDir(cfg, agentId);
}

function resolveStatePaths(cfg: SurprisebotConfig) {
  const workspace = resolveWorkspaceDir(cfg);
  const memoryDir = path.join(workspace, "memory");
  return {
    workspace,
    statePath: path.join(memoryDir, "artemis.state.json"),
    statusPath: path.join(memoryDir, "artemis.status.json"),
  };
}

async function loadState(statePath: string): Promise<ArtemisRunnerState> {
  try {
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as ArtemisRunnerState;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

async function saveState(statePath: string, state: ArtemisRunnerState) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2));
}

async function writeStatus(statusPath: string, payload: Record<string, unknown>) {
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  await fs.writeFile(statusPath, JSON.stringify(payload, null, 2));
}

function minutesToMs(minutes?: number): number {
  if (!minutes || !Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.max(60_000, Math.round(minutes * 60_000));
}

function createRunId(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

async function appendRunLedger(params: {
  cfg: SurprisebotConfig;
  runId: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  jobType: string;
  command?: string | null;
  logPath?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  exitCode?: number | null;
}) {
  await appendMissionControlRecord({
    cfg: params.cfg,
    kind: "run-ledger",
    record: {
      id: params.runId,
      ts: new Date().toISOString(),
      status: params.status,
      jobType: params.jobType,
      command: params.command ?? null,
      logPath: params.logPath ?? null,
      startedAt: params.startedAt ?? null,
      finishedAt: params.finishedAt ?? null,
      exitCode: params.exitCode ?? null,
    },
  });
}

async function maybeRunStanford(cfg: SurprisebotConfig, state: ArtemisRunnerState) {
  const artemisCfg = cfg.artemis?.stanford;
  if (!cfg.artemis?.enabled || !artemisCfg?.enabled) return;
  if (!artemisCfg.configPath) {
    log.warn("Stanford Artemis configPath missing; skipping run");
    return;
  }
  const intervalMs = minutesToMs(artemisCfg.intervalMinutes);
  if (intervalMs <= 0) return;
  if (state.stanfordRunning) return;
  if (state.lastStanfordRunAt && Date.now() - state.lastStanfordRunAt < intervalMs) return;

  const agentId = resolveDefaultAgentId(cfg) ?? "default";
  const jobType = artemisCfg.jobType ?? "artemis-stanford";
  const budget = await evaluateBudget({ cfg, agentId, jobType });
  if (budget.decision === "deny" || budget.decision === "defer") {
    log.warn(`Stanford Artemis blocked by budget: ${budget.reason}`);
    return;
  }

  const runId = createRunId("artemis-stanford");
  const artemisDir = artemisCfg.artemisDir ?? (await resolveDefaultArtemisDir());
  const sessionRoot = artemisCfg.sessionRoot ?? path.join(artemisDir, "logs");
  const sessionDir = path.join(sessionRoot, `surprisebot_session_${runId}`);
  await fs.mkdir(sessionDir, { recursive: true });

  const outputDir =
    artemisCfg.outputDir ?? path.join(resolveWorkspaceDir(cfg), "research", "outputs");

  const startedAt = new Date().toISOString();
  state.stanfordRunning = true;
  state.lastStanfordRunAt = Date.now();
  state.lastStanfordRunId = runId;
  state.lastStanfordSessionDir = sessionDir;

  await writeStatus(resolveStatePaths(cfg).statusPath, {
    stanford: {
      runId,
      running: true,
      startedAt,
      sessionDir,
      outputDir,
    },
  });
  await appendRunLedger({
    cfg,
    runId,
    status: "running",
    jobType,
    startedAt,
  });

  log.info(`Stanford Artemis run started: ${runId}`);

  try {
  let usePromptGeneration = artemisCfg.usePromptGeneration;
  const feedback = artemisCfg.promptFeedback;
  if (feedback?.enabled && usePromptGeneration === undefined) {
    const metrics = await loadLatestArtemisMetrics(cfg, "artemis-stanford");
    const minSamples = feedback.minSamples ?? 3;
    const minPrecision = feedback.minPrecision ?? 0.6;
    if (metrics && metrics.sampleSize >= minSamples) {
      const action = feedback.action ?? "disable_prompt_generation";
      if (metrics.precision < minPrecision) {
        usePromptGeneration = action === "prefer_prompt_generation";
        log.warn(
          `Stanford Artemis prompt feedback applied: precision ${metrics.precision.toFixed(2)} < ${minPrecision} -> ${usePromptGeneration ? "enable" : "disable"} prompt generation`,
        );
      }
    }
  }

    const result = await runStanfordArtemis({
      artemisDir,
      configPath: artemisCfg.configPath,
      outputDir,
      pythonBin: artemisCfg.pythonBin,
      durationMinutes: artemisCfg.durationMinutes,
      supervisorModel: artemisCfg.supervisorModel,
      sessionDir,
      codexBinary: artemisCfg.codexBinary,
      benchmarkMode: artemisCfg.benchmarkMode !== false,
      skipTodos: artemisCfg.skipTodos,
      usePromptGeneration,
      finishOnSubmit: artemisCfg.finishOnSubmit,
      env: {
        ...artemisCfg.env,
        SURPRISEBOT_RUN_ID: runId,
      },
    });

    state.stanfordRunning = false;
    state.lastStanfordExitCode = result.exitCode;
    await saveState(resolveStatePaths(cfg).statePath, state);

    await appendRunLedger({
      cfg,
      runId,
      status: result.ok ? "done" : "failed",
      jobType,
      finishedAt: new Date().toISOString(),
      exitCode: result.exitCode ?? null,
      command: result.argv.join(" "),
    });

    if (artemisCfg.syncArtifacts !== false) {
      await syncStanfordArtifacts({ cfg, runId, sessionDir });
    }

    await writeStatus(resolveStatePaths(cfg).statusPath, {
      stanford: {
        runId,
        running: false,
        finishedAt: new Date().toISOString(),
        sessionDir,
        outputDir,
        exitCode: result.exitCode,
      },
    });
  } catch (err) {
    state.stanfordRunning = false;
    await saveState(resolveStatePaths(cfg).statePath, state);
    await appendRunLedger({
      cfg,
      runId,
      status: "failed",
      jobType,
      finishedAt: new Date().toISOString(),
    });
    log.error(`Stanford Artemis run failed: ${String(err)}`);
  }
}

async function maybeRunCert(cfg: SurprisebotConfig, state: ArtemisRunnerState) {
  const certCfg = cfg.artemis?.cert;
  if (!cfg.artemis?.enabled || !certCfg?.enabled) return;
  if (!certCfg.command && !certCfg.inputPath) return;
  const intervalMs = minutesToMs(certCfg.intervalMinutes);
  if (intervalMs <= 0) return;
  if (state.certRunning) return;
  if (state.lastCertRunAt && Date.now() - state.lastCertRunAt < intervalMs) return;

  const agentId = resolveDefaultAgentId(cfg) ?? "default";
  const jobType = certCfg.jobType ?? "artemis-cert";
  const budget = await evaluateBudget({ cfg, agentId, jobType });
  if (budget.decision === "deny" || budget.decision === "defer") {
    log.warn(`CERT Artemis blocked by budget: ${budget.reason}`);
    return;
  }

  const runId = createRunId("artemis-cert");
  const outputDir = certCfg.outputDir ?? path.join(resolveWorkspaceDir(cfg), "research", "outputs");
  const runDir = path.join(resolveWorkspaceDir(cfg), "research", "runs");
  const logPath = path.join(runDir, `artemis-cert-${runId}.log`);
  const startedAt = new Date().toISOString();
  state.certRunning = true;
  state.lastCertRunAt = Date.now();
  state.lastCertRunId = runId;
  state.lastCertLogPath = logPath;

  await fs.mkdir(runDir, { recursive: true });

  await appendRunLedger({
    cfg,
    runId,
    status: "running",
    jobType,
    startedAt,
    logPath,
  });

  let exitCode: number | null = null;
  let command: string | null = null;

  try {
    if (certCfg.command) {
      const argv = [certCfg.command, ...(certCfg.args ?? [])];
      command = argv.join(" ");
      const timeoutMinutes = certCfg.timeoutMinutes ?? 60;
      const result = await runCommandWithTimeout(argv, {
        timeoutMs: Math.max(60_000, Math.round(timeoutMinutes * 60_000)),
        cwd: certCfg.workingDir,
        env: certCfg.env,
      });
      exitCode = result.code;
      await fs.appendFile(logPath, result.stdout + result.stderr);
      if (result.code !== 0) {
        log.warn(`CERT Artemis runner exited with code ${result.code}`);
      }
    }

    if (certCfg.inputPath) {
      await ingestArtemisOutputs({
        inputPath: certCfg.inputPath,
        outputDir,
        outputFile: certCfg.outputFile,
        source: certCfg.source,
        runId,
      });
    }

    state.certRunning = false;
    state.lastCertExitCode = exitCode ?? null;
    await saveState(resolveStatePaths(cfg).statePath, state);
    await appendRunLedger({
      cfg,
      runId,
      status: exitCode && exitCode !== 0 ? "failed" : "done",
      jobType,
      finishedAt: new Date().toISOString(),
      exitCode: exitCode ?? null,
      command,
      logPath,
    });
  } catch (err) {
    state.certRunning = false;
    state.lastCertExitCode = exitCode ?? null;
    await saveState(resolveStatePaths(cfg).statePath, state);
    await appendRunLedger({
      cfg,
      runId,
      status: "failed",
      jobType,
      finishedAt: new Date().toISOString(),
      exitCode: exitCode ?? null,
      command,
      logPath,
    });
    log.error(`CERT Artemis run failed: ${String(err)}`);
  }
}


export function startArtemisRunner(cfg: SurprisebotConfig) {
  const { statePath, statusPath } = resolveStatePaths(cfg);
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const intervalCandidates = [
    minutesToMs(cfg.artemis?.stanford?.intervalMinutes),
    minutesToMs(cfg.artemis?.cert?.intervalMinutes),
  ].filter((value) => value > 0);
  const intervalMs = intervalCandidates.length ? Math.min(...intervalCandidates) : 0;

  if (!cfg.artemis?.enabled || intervalMs <= 0) {
    log.info("artemis runner disabled (no schedule)");
    return { stop: () => {} };
  }

  const tick = async () => {
    if (stopped) return;
    const state = await loadState(statePath);
    await maybeRunStanford(cfg, state);
    await maybeRunCert(cfg, state);
    await saveState(statePath, state);
    await writeStatus(statusPath, {
      stanford: {
        runId: state.lastStanfordRunId ?? null,
        running: state.stanfordRunning ?? false,
        sessionDir: state.lastStanfordSessionDir ?? null,
        exitCode: state.lastStanfordExitCode ?? null,
      },
      cert: {
        runId: state.lastCertRunId ?? null,
        running: state.certRunning ?? false,
        lastRunAt: state.lastCertRunAt ?? null,
        exitCode: state.lastCertExitCode ?? null,
        logPath: state.lastCertLogPath ?? null,
      },
    });
  };

  timer = setInterval(() => {
    tick().catch((err) => log.error(`artemis runner tick failed: ${String(err)}`));
  }, Math.max(intervalMs, 60_000));

  tick().catch((err) => log.error(`artemis runner initial tick failed: ${String(err)}`));

  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}
