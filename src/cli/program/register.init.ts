import type { Command } from "commander";
import { initCommand } from "../../commands/init.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";

function parseOptionalFloat(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Bootstrap state + workspace, then run onboarding")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/init", "docs.surprisebot.bot/cli/init")}\n`,
    )
    .option("--home <dir>", "Set SURPRISEBOT_HOME for this run")
    .option("--state-dir <dir>", "Set SURPRISEBOT_STATE_DIR for this run")
    .option("--workspace <dir>", "Agent workspace directory")
    .option("--profile-template <name>", "Preseed agent roster from a bundled profile")
    .option("--skip-health", "Skip system health guard", false)
    .option("--allow-low-resources", "Override low resource guard", false)
    .option("--min-ram-gb <gb>", "Minimum RAM required (GiB)")
    .option("--min-disk-gb <gb>", "Minimum free disk required (GiB)")
    .option("--skip-onboard", "Skip onboarding wizard", false)
    .option("--non-interactive", "Run onboarding without prompts", false)
    .option("--accept-risk", "Acknowledge risk for non-interactive onboarding", false)
    .option("--mode <mode>", "Onboarding mode: local|remote")
    .option("--flow <flow>", "Onboarding flow: quickstart|advanced")
    .option("--quickstart", "Alias for --flow quickstart", false)
    .option("--advanced", "Alias for --flow advanced", false)
    .option("--minimal", "Skip skills + UI install (keeps channels/auth)", false)
    .option("--full", "Enable optional installs + daemon", false)
    .option("--remote-url <url>", "Remote Gateway WebSocket URL")
    .option("--remote-token <token>", "Remote Gateway token (optional)")
    .option("--auth-choice <choice>", "Auth choice for onboarding")
    .option("--install-daemon", "Install gateway daemon during onboarding", false)
    .option("--daemon-runtime <runtime>", "Daemon runtime (node|bun)")
    .option("--skip-channels", "Skip channel setup during onboarding", false)
    .option("--skip-providers", "Legacy alias for --skip-channels", false)
    .option("--skip-skills", "Skip skills install during onboarding", false)
    .option("--skip-ui", "Skip UI setup during onboarding", false)
    .option("--install-bun", "Install Bun (optional tooling)", false)
    .option("--install-qmd", "Install qmd (requires Bun)", false)
    .option("--install-docker", "Install Docker (Linux only)", false)
    .option("--yes", "Auto-confirm optional installs", false)
    .option("--json", "Output JSON summary", false)
    .action(async (opts) => {
      try {
        const summary = await initCommand(
          {
            home: opts.home,
            stateDir: opts.stateDir,
            workspace: opts.workspace,
            profileTemplate: opts.profileTemplate,
            skipHealth: Boolean(opts.skipHealth),
            allowLowResources: Boolean(opts.allowLowResources),
            minRamGb: parseOptionalFloat(opts.minRamGb),
            minDiskGb: parseOptionalFloat(opts.minDiskGb),
            skipOnboard: Boolean(opts.skipOnboard),
            nonInteractive: Boolean(opts.nonInteractive),
            acceptRisk: Boolean(opts.acceptRisk),
            mode: opts.mode,
            flow: opts.flow,
            quickstart: Boolean(opts.quickstart),
            advanced: Boolean(opts.advanced),
            minimal: Boolean(opts.minimal),
            full: Boolean(opts.full),
            remoteUrl: opts.remoteUrl,
            remoteToken: opts.remoteToken,
            authChoice: opts.authChoice,
            installDaemon: Boolean(opts.installDaemon),
            daemonRuntime: opts.daemonRuntime,
            skipChannels: Boolean(opts.skipChannels),
            skipProviders: Boolean(opts.skipProviders),
            skipSkills: Boolean(opts.skipSkills),
            skipUi: Boolean(opts.skipUi),
            installBun: Boolean(opts.installBun),
            installQmd: Boolean(opts.installQmd),
            installDocker: Boolean(opts.installDocker),
            yes: Boolean(opts.yes),
          },
          defaultRuntime,
        );
        if (opts.json) {
          defaultRuntime.log(JSON.stringify(summary, null, 2));
        }
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}
