import type { Command } from "commander";

import { loadConfig } from "../config/config.js";
import { defaultRuntime } from "../runtime.js";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace.js";
import path from "node:path";
import { runStanfordArtemis, resolveDefaultArtemisDir } from "../infra/artemis/runner.js";
import { ingestArtemisOutputs } from "../infra/artemis/ingest.js";

function resolveDefaultOutputDir(): string {
  const cfg = loadConfig();
  const agentId = resolveDefaultAgentId(cfg);
  const fallback = resolveDefaultAgentWorkspaceDir();
  if (!agentId) return path.join(fallback, "research", "outputs");
  const workspace = resolveAgentWorkspaceDir(cfg, agentId) ?? fallback;
  return path.join(workspace, "research", "outputs");
}

function parseEnvPairs(values: string[] | undefined): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of values ?? []) {
    const [key, ...rest] = entry.split("=");
    if (!key || rest.length === 0) continue;
    env[key] = rest.join("=");
  }
  return env;
}

export function registerArtemisCli(program: Command) {
  const artemis = program.command("artemis").description("ARTEMIS integrations");

  artemis
    .command("stanford:run")
    .description("Run Stanford ARTEMIS with Surprisebot outputs")
    .requiredOption("--config <path>", "Path to ARTEMIS task config YAML")
    .option("--artemis-dir <path>", "Path to ARTEMIS repo")
    .option("--output-dir <path>", "Surprisebot research outputs directory")
    .option("--python <path>", "Python interpreter", "python")
    .option("--duration <minutes>", "Duration in minutes", (v) => Number(v))
    .option("--supervisor-model <model>")
    .option("--session-dir <path>")
    .option("--resume-dir <path>")
    .option("--codex-binary <path>")
    .option("--verbose", "Enable verbose logging")
    .option("--benchmark-mode", "Enable benchmark mode")
    .option("--skip-todos", "Skip initial TODO generation")
    .option("--use-prompt-generation", "Enable prompt generation")
    .option("--finish-on-submit", "Stop after first submission")
    .option("--no-config-patch", "Use config as-is without Surprisebot submission_config")
    .option("--env <KEY=VALUE>", "Additional environment variables", (v, acc: string[]) => {
      acc.push(v);
      return acc;
    }, [])
    .action(async (opts) => {
      const outputDir = opts.outputDir ?? resolveDefaultOutputDir();
      const artemisDir = opts.artemisDir ?? (await resolveDefaultArtemisDir());

      const res = await runStanfordArtemis({
        artemisDir,
        configPath: opts.config,
        outputDir,
        pythonBin: opts.python,
        durationMinutes: Number.isFinite(opts.duration) ? opts.duration : undefined,
        supervisorModel: opts.supervisorModel,
        sessionDir: opts.sessionDir,
        resumeDir: opts.resumeDir,
        verbose: opts.verbose,
        codexBinary: opts.codexBinary,
        benchmarkMode: opts.benchmarkMode,
        skipTodos: opts.skipTodos,
        usePromptGeneration: opts.usePromptGeneration,
        finishOnSubmit: opts.finishOnSubmit,
        patchConfig: opts.configPatch,
        env: parseEnvPairs(opts.env),
      });

      defaultRuntime.log(JSON.stringify({
        ...res,
        artemisDir,
        outputDir,
      }, null, 2));
    });

  artemis
    .command("cert:ingest")
    .description("Ingest CERT/Artemis outputs into Surprisebot research outputs")
    .requiredOption("--input <path>", "Input file or directory")
    .option("--output-dir <path>", "Surprisebot research outputs directory")
    .option("--output-file <path>")
    .option("--source <name>", "Source label", "artemis-cert")
    .action(async (opts) => {
      const outputDir = opts.outputDir ?? resolveDefaultOutputDir();
      const res = await ingestArtemisOutputs({
        inputPath: opts.input,
        outputDir,
        outputFile: opts.outputFile,
        source: opts.source,
      });
      defaultRuntime.log(JSON.stringify(res, null, 2));
    });
}
