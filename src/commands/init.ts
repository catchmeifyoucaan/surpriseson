import fs from "node:fs";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace.js";
import { resolveConfigPath, resolveStateDir } from "../config/paths.js";
import type { SurprisebotConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { assertSupportedRuntime } from "../infra/runtime-guard.js";
import { createClackPrompter } from "../wizard/clack-prompter.js";
import type { OnboardOptions } from "./onboard.js";
import { onboardCommand } from "./onboard.js";
import { setupCommand } from "./setup.js";
import { loadProfileTemplateConfig } from "./profile-templates.js";
import { checkSystemHealth, formatSystemHealthSummary } from "./system-health.js";

export type InitSummary = {
  ok: boolean;
  workspace: string;
  stateDir: string;
  configPath: string;
  lowResources: boolean;
  skippedOnboard: boolean;
  installs: { bun: boolean; qmd: boolean; docker: boolean };
  profileTemplate?: string;
  health?: unknown;
};

export type InitOptions = {
  home?: string;
  stateDir?: string;
  workspace?: string;
  profileTemplate?: string;
  skipHealth?: boolean;
  allowLowResources?: boolean;
  minRamGb?: number;
  minDiskGb?: number;
  skipOnboard?: boolean;
  flow?: OnboardOptions["flow"];
  quickstart?: boolean;
  advanced?: boolean;
  minimal?: boolean;
  full?: boolean;
  nonInteractive?: boolean;
  acceptRisk?: boolean;
  mode?: OnboardOptions["mode"];
  remoteUrl?: string;
  remoteToken?: string;
  authChoice?: OnboardOptions["authChoice"];
  installDaemon?: boolean;
  daemonRuntime?: OnboardOptions["daemonRuntime"];
  skipChannels?: boolean;
  skipProviders?: boolean;
  skipSkills?: boolean;
  skipUi?: boolean;
  installBun?: boolean;
  installQmd?: boolean;
  installDocker?: boolean;
  yes?: boolean;
};

async function hasCommand(bin: string): Promise<boolean> {
  if (process.platform === "win32") {
    const res = await runCommandWithTimeout(["where", bin], { timeoutMs: 5_000 });
    return res.code === 0 && res.stdout.trim().length > 0;
  }
  const res = await runCommandWithTimeout(["sh", "-lc", `command -v ${bin}`], {
    timeoutMs: 5_000,
  });
  return res.code === 0 && res.stdout.trim().length > 0;
}

async function runShell(cmd: string, timeoutMs: number): Promise<boolean> {
  const res = await runCommandWithTimeout(["sh", "-lc", cmd], { timeoutMs });
  return res.code === 0;
}

async function maybeInstallTool(params: {
  id: string;
  label: string;
  requested: boolean;
  installed: boolean;
  installCommand?: string;
  timeoutMs?: number;
  runtime: RuntimeEnv;
  prompt: (message: string) => Promise<boolean>;
}): Promise<void> {
  const { id, label, requested, installed, installCommand, timeoutMs, runtime, prompt } = params;
  if (installed) {
    runtime.log(`${label}: already installed.`);
    return;
  }
  if (!requested) {
    runtime.log(`${label}: not installed (skipped).`);
    return;
  }
  if (!installCommand) {
    runtime.error(`${label}: install command unavailable on this platform.`);
    return;
  }
  const ok = await prompt(`Install ${label}?`);
  if (!ok) {
    runtime.log(`${label}: skipped.`);
    return;
  }
  runtime.log(`${label}: installing...`);
  const success = await runShell(installCommand, timeoutMs ?? 600_000);
  if (!success) {
    runtime.error(`${label}: install failed. Re-run with --yes or install manually.`);
    return;
  }
  runtime.log(`${label}: installed.`);
}

export async function initCommand(opts: InitOptions, runtime: RuntimeEnv = defaultRuntime) {
  assertSupportedRuntime(runtime);
  if (opts.home) process.env.SURPRISEBOT_HOME = opts.home;
  if (opts.stateDir) process.env.SURPRISEBOT_STATE_DIR = opts.stateDir;

  const workspace = opts.workspace ?? resolveDefaultAgentWorkspaceDir();
  const stateDir = resolveStateDir();

  const wantsQuickstart = Boolean(opts.quickstart);
  const wantsAdvanced = Boolean(opts.advanced);
  let flow = opts.flow;
  if (wantsQuickstart) flow = "quickstart";
  if (wantsAdvanced) flow = "advanced";

  const applyMinimal = Boolean(opts.minimal);
  const applyFull = Boolean(opts.full);
  let installDaemon = opts.installDaemon ?? (applyFull ? true : undefined);
  let installBun = opts.installBun ?? (applyFull ? true : undefined);
  let installQmd = opts.installQmd ?? (applyFull ? true : undefined);
  let installDocker = opts.installDocker ?? (applyFull ? true : undefined);
  const skipSkills = opts.skipSkills ?? (applyMinimal ? true : undefined);
  const skipUi = opts.skipUi ?? (applyMinimal ? true : undefined);
  let lowResources = false;
  let healthDetails: unknown = undefined;
  if (!opts.skipHealth) {
    const check = await checkSystemHealth({
      minRamGb: opts.minRamGb,
      minDiskGb: opts.minDiskGb,
      paths: [stateDir, workspace],
    });
    healthDetails = check;
    for (const line of formatSystemHealthSummary(check)) runtime.log(line);
    if (check.warnings.length > 0) {
      runtime.log(`Warnings: ${check.warnings.join(" ")}`);
    }
    lowResources = !check.ok || check.warnings.length > 0;
    if (!check.ok && !opts.allowLowResources) {
      runtime.error(`Health guard failed: ${check.errors.join(" ")}`);
      runtime.error("Re-run with --allow-low-resources or --skip-health to override.");
      runtime.exit(1);
      return;
    }
  }

  if (lowResources && !opts.allowLowResources) {
    runtime.log("Low-resource mode: heavy components disabled by default.");
    if (installDocker === undefined) installDocker = false;
    if (installQmd === undefined) installQmd = false;
    if (installBun === undefined && installQmd === false) installBun = false;
  }

  const configPathBefore = resolveConfigPath();
  const configExists = fs.existsSync(configPathBefore);
  const lowResourceOverrides = lowResources && !configExists ? {
    artemis: {
      enabled: false,
      stanford: { enabled: false },
      cert: { enabled: false },
    },
  } : undefined;

  let profileTemplateName: string | undefined = opts.profileTemplate?.trim() || undefined;
  let profileTemplateConfig: SurprisebotConfig | undefined = undefined;
  if (profileTemplateName) {
    const loaded = await loadProfileTemplateConfig(profileTemplateName);
    if (!loaded) {
      runtime.error(`Unknown profile template: ${profileTemplateName}`);
      runtime.error("Expected profiles/<name>/agents.json5 in the Surprisebot package.");
      runtime.exit(1);
      return;
    }
    profileTemplateConfig = loaded.config;
  }

  await setupCommand({ workspace, overrides: lowResourceOverrides, profileTemplate: profileTemplateConfig }, runtime);


  if (!opts.skipOnboard) {
    await onboardCommand(
      {
        workspace,
        nonInteractive: opts.nonInteractive,
        acceptRisk: opts.acceptRisk,
        mode: opts.mode,
        flow,
        remoteUrl: opts.remoteUrl,
        remoteToken: opts.remoteToken,
        authChoice: opts.authChoice,
        installDaemon: installDaemon ?? opts.installDaemon,
        daemonRuntime: opts.daemonRuntime,
        skipChannels: opts.skipChannels,
        skipProviders: opts.skipProviders,
        skipSkills: skipSkills ?? opts.skipSkills,
        skipHealth: opts.skipHealth,
        skipUi: skipUi ?? opts.skipUi,
      },
      runtime,
    );
  }

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const prompter = createClackPrompter();
  const prompt = async (message: string) => {
    if (opts.yes) return true;
    if (!interactive) return false;
    return await prompter.confirm({ message, initialValue: true });
  };

  const bunInstalled = await hasCommand("bun");
  const qmdInstalled = await hasCommand("qmd");
  const dockerInstalled = await hasCommand("docker");

  const bunInstallCmd =
    process.platform === "darwin"
      ? "brew install oven-sh/bun/bun"
      : process.platform === "linux"
        ? "curl -fsSL https://bun.sh/install | bash"
        : undefined;
  const qmdInstallCmd = bunInstalled
    ? "bun install -g https://github.com/tobi/qmd"
    : undefined;
  const isRoot = typeof process.getuid == "function" ? process.getuid() == 0 : false;
  const dockerInstallCmd =
    process.platform === "linux" && isRoot
      ? "apt-get update && apt-get install -y docker.io"
      : undefined;
  if (opts.installDocker && process.platform === "linux" && !isRoot) {
    runtime.error("Docker install requires root; re-run as root or install manually.");
  }

  await maybeInstallTool({
    id: "bun",
    label: "Bun",
    requested: Boolean((installBun ?? opts.installBun) || ((installQmd ?? opts.installQmd) && !bunInstalled)),
    installed: bunInstalled,
    installCommand: bunInstallCmd,
    runtime,
    prompt,
    timeoutMs: 600_000,
  });

  const bunNowInstalled = bunInstalled || (await hasCommand("bun"));
  const qmdCmd = bunNowInstalled ? "bun install -g https://github.com/tobi/qmd" : undefined;
  await maybeInstallTool({
    id: "qmd",
    label: "qmd",
    requested: Boolean(installQmd ?? opts.installQmd),
    installed: qmdInstalled,
    installCommand: qmdCmd,
    runtime,
    prompt,
    timeoutMs: 600_000,
  });

  await maybeInstallTool({
    id: "docker",
    label: "Docker",
    requested: Boolean(installDocker ?? opts.installDocker),
    installed: dockerInstalled,
    installCommand: dockerInstallCmd,
    runtime,
    prompt,
    timeoutMs: 1_200_000,
  });

  const configPath = resolveConfigPath();
  runtime.log(`Init complete. Workspace: ${workspace}`);
  runtime.log(`State dir: ${stateDir}`);
  runtime.log(`Config path: ${configPath}`);
  const finalConfigPath = resolveConfigPath();
  const finalBun = await hasCommand("bun");
  const finalQmd = await hasCommand("qmd");
  const finalDocker = await hasCommand("docker");
  const summary: InitSummary = {
    ok: true,
    workspace,
    stateDir,
    configPath: finalConfigPath,
    lowResources,
    skippedOnboard: Boolean(opts.skipOnboard),
    installs: { bun: finalBun, qmd: finalQmd, docker: finalDocker },
    profileTemplate: profileTemplateName,
    health: healthDetails,
  };

  if (opts.home || opts.stateDir) {
    runtime.log(
      "Tip: export SURPRISEBOT_HOME or SURPRISEBOT_STATE_DIR for future runs to keep using this location.",
    );
  }
  return summary;
}
