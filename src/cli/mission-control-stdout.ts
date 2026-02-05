import process from "node:process";
import { Command } from "commander";

import { registerMissionControlCli } from "./mission-control-cli.js";
import { loadDotEnv } from "../infra/dotenv.js";
import { normalizeEnv } from "../infra/env.js";
import { assertSupportedRuntime } from "../infra/runtime-guard.js";
import { installUnhandledRejectionHandler } from "../infra/unhandled-rejections.js";

async function main(argv = process.argv) {
  loadDotEnv({ quiet: true });
  normalizeEnv();
  assertSupportedRuntime();
  installUnhandledRejectionHandler();

  const program = new Command();
  program.name("mission-control");
  registerMissionControlCli(program);

  await program.parseAsync(argv);
}

main().catch((err) => {
  console.error("[mission-control]", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
