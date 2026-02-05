import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { runCommandWithTimeout } from "../../process/exec.js";

export type StanfordArtemisRunOptions = {
  artemisDir: string;
  configPath: string;
  outputDir?: string;
  pythonBin?: string;
  durationMinutes?: number;
  supervisorModel?: string;
  sessionDir?: string;
  resumeDir?: string;
  verbose?: boolean;
  codexBinary?: string;
  benchmarkMode?: boolean;
  skipTodos?: boolean;
  usePromptGeneration?: boolean;
  finishOnSubmit?: boolean;
  patchConfig?: boolean;
  env?: Record<string, string>;
};

export type StanfordArtemisRunResult = {
  ok: boolean;
  configPath: string;
  patched: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  argv: string[];
};

type SpawnOutcome = { code: number | null; signal: NodeJS.Signals | null };

async function spawnWithInherit(
  argv: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<SpawnOutcome> {
  return await new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
}

async function writePatchedConfig(params: {
  pythonBin: string;
  configPath: string;
  outputDir?: string;
  cwd?: string;
}): Promise<string> {
  const script = `import os, sys, tempfile, yaml\n\nconfig_path = sys.argv[1]\noutput_dir = sys.argv[2] if len(sys.argv) > 2 else ''\n\nwith open(config_path, 'r') as f:\n    data = yaml.safe_load(f) or {}\nif not isinstance(data, dict):\n    data = {}\nsubmission = data.get('submission_config') or {}\nif not isinstance(submission, dict):\n    submission = {}\nsubmission['type'] = 'surprisebot'\nif output_dir:\n    submission['output_dir'] = output_dir\ndata['submission_config'] = submission\nfd, out_path = tempfile.mkstemp(prefix='artemis-config-', suffix='.yaml')\nwith os.fdopen(fd, 'w') as out:\n    yaml.safe_dump(data, out, sort_keys=False)\nprint(out_path)\n`;

  const { stdout } = await runCommandWithTimeout(
    [params.pythonBin, "-", params.configPath, params.outputDir ?? ""],
    {
      timeoutMs: 30_000,
      cwd: params.cwd,
      input: script,
    },
  );

  const outputPath = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
  if (!outputPath) {
    throw new Error("failed to generate patched config file");
  }
  return outputPath;
}

export async function runStanfordArtemis(options: StanfordArtemisRunOptions): Promise<StanfordArtemisRunResult> {
  const start = Date.now();
  const pythonBin = options.pythonBin ?? "python";
  const benchmarkMode = options.benchmarkMode !== false;
  const patchConfig = options.patchConfig !== false;

  if (options.outputDir) {
    await fs.mkdir(options.outputDir, { recursive: true });
  }

  let configPath = options.configPath;
  let patched = false;
  if (patchConfig) {
    configPath = await writePatchedConfig({
      pythonBin,
      configPath: options.configPath,
      outputDir: options.outputDir,
      cwd: options.artemisDir,
    });
    patched = true;
  }

  const args: string[] = ["-m", "supervisor.supervisor", "--config-file", configPath];
  if (options.durationMinutes) args.push("--duration", String(options.durationMinutes));
  if (options.supervisorModel) args.push("--supervisor-model", options.supervisorModel);
  if (options.sessionDir) args.push("--session-dir", options.sessionDir);
  if (options.resumeDir) args.push("--resume-dir", options.resumeDir);
  if (options.verbose) args.push("--verbose");
  if (options.codexBinary) args.push("--codex-binary", options.codexBinary);
  if (benchmarkMode) args.push("--benchmark-mode");
  if (options.skipTodos) args.push("--skip-todos");
  if (options.usePromptGeneration) args.push("--use-prompt-generation");
  if (options.finishOnSubmit) args.push("--finish-on-submit");

  const env = {
    ...(options.env ?? {}),
  } as Record<string, string>;
  if (options.outputDir) {
    env.SURPRISEBOT_OUTPUT_DIR = options.outputDir;
  }

  const { code, signal } = await spawnWithInherit([pythonBin, ...args], {
    cwd: options.artemisDir,
    env,
  });

  return {
    ok: code === 0,
    configPath,
    patched,
    exitCode: code,
    signal,
    durationMs: Date.now() - start,
    argv: [pythonBin, ...args],
  };
}

export async function resolveDefaultArtemisDir(): Promise<string> {
  const candidates = [
    process.env.ARTEMIS_STANFORD_DIR,
    process.env.SURPRISEBOT_ARTEMIS_DIR,
    path.join(os.homedir(), "ARTEMIS"),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {
      continue;
    }
  }
  return path.join(os.homedir(), "ARTEMIS");
}
