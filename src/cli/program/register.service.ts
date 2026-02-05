import type { Command } from "commander";
import { runDaemonInstall, runDaemonUninstall } from "../daemon-cli.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";

export function registerServiceCommands(program: Command) {
  program
    .command("install-service")
    .description("Install the Gateway service (alias for `daemon install`)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/daemon", "docs.surprisebot.bot/cli/daemon")}\n`,
    )
    .option("--port <port>", "Gateway port")
    .option("--runtime <runtime>", "Daemon runtime (node|bun). Default: node")
    .option("--token <token>", "Gateway token (token auth)")
    .option("--force", "Reinstall/overwrite if already installed", false)
    .action(async (opts) => {
      await runDaemonInstall(opts);
    });

  program
    .command("uninstall-service")
    .description("Uninstall the Gateway service (alias for `daemon uninstall`)")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/daemon", "docs.surprisebot.bot/cli/daemon")}\n`,
    )
    .action(async () => {
      await runDaemonUninstall();
    });
}
