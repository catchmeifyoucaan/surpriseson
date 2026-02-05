import type { Command } from "commander";
import { formatDocsLink } from "../../terminal/links.js";
import { isRich, theme } from "../../terminal/theme.js";
import { formatCliBannerLine, hasEmittedCliBanner } from "../banner.js";
import type { ProgramContext } from "./context.js";

const EXAMPLES = [
  [
    "surprisebot channels login --verbose",
    "Link personal WhatsApp Web and show QR + connection logs.",
  ],
  [
    'surprisebot message send --to +15555550123 --message "Hi" --json',
    "Send via your web session and print JSON result.",
  ],
  ["surprisebot gateway --port 18789", "Run the WebSocket Gateway locally."],
  ["surprisebot --dev gateway", "Run a dev Gateway (isolated state/config) on ws://127.0.0.1:19001."],
  ["surprisebot gateway --force", "Kill anything bound to the default gateway port, then start it."],
  ["surprisebot gateway ...", "Gateway control via WebSocket."],
  [
    'surprisebot agent --to +15555550123 --message "Run summary" --deliver',
    "Talk directly to the agent using the Gateway; optionally send the WhatsApp reply.",
  ],
  [
    'surprisebot message send --channel telegram --to @mychat --message "Hi"',
    "Send via your Telegram bot.",
  ],
] as const;

export function configureProgramHelp(program: Command, ctx: ProgramContext) {
  program
    .name("surprisebot")
    .description("")
    .version(ctx.programVersion)
    .option(
      "--dev",
      "Dev profile: isolate state under ~/.surprisebot-dev, default gateway port 19001, and shift derived ports (bridge/browser/canvas)",
    )
    .option(
      "--profile <name>",
      "Use a named profile (isolates SURPRISEBOT_STATE_DIR/SURPRISEBOT_CONFIG_PATH under ~/.surprisebot-<name>)",
    );

  program.option("--no-color", "Disable ANSI colors", false);

  program.configureHelp({
    optionTerm: (option) => theme.option(option.flags),
    subcommandTerm: (cmd) => theme.command(cmd.name()),
  });

  program.configureOutput({
    writeOut: (str) => {
      const colored = str
        .replace(/^Usage:/gm, theme.heading("Usage:"))
        .replace(/^Options:/gm, theme.heading("Options:"))
        .replace(/^Commands:/gm, theme.heading("Commands:"));
      process.stdout.write(colored);
    },
    writeErr: (str) => process.stderr.write(str),
    outputError: (str, write) => write(theme.error(str)),
  });

  if (
    process.argv.includes("-V") ||
    process.argv.includes("--version") ||
    process.argv.includes("-v")
  ) {
    console.log(ctx.programVersion);
    process.exit(0);
  }

  program.addHelpText("beforeAll", () => {
    if (hasEmittedCliBanner()) return "";
    const rich = isRich();
    const line = formatCliBannerLine(ctx.programVersion, { richTty: rich });
    return `\n${line}\n`;
  });

  const fmtExamples = EXAMPLES.map(
    ([cmd, desc]) => `  ${theme.command(cmd)}\n    ${theme.muted(desc)}`,
  ).join("\n");

  program.addHelpText("afterAll", () => {
    const docs = formatDocsLink("/cli", "docs.surprisebot.bot/cli");
    return `\n${theme.heading("Examples:")}\n${fmtExamples}\n\n${theme.muted("Docs:")} ${docs}\n`;
  });
}
