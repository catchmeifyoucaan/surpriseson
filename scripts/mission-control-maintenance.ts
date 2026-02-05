import { loadConfig } from "../src/config/config.js";
import { pruneMissionControlDuplicates } from "../src/infra/mission-control/maintenance.js";

async function main() {
  const cfg = loadConfig();
  const result = await pruneMissionControlDuplicates(cfg);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
