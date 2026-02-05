import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import type { SurprisebotConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging.js";
import { resolveMissionControlPaths, type MissionControlRecordKind } from "./ledger.js";

const log = createSubsystemLogger("gateway/mission-control-rollup");
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_KEEP_DAYS = 7;
const DEFAULT_MIN_BYTES = 256 * 1024;

export type MissionControlRollupResult = {
  rolledKinds: Array<{ kind: MissionControlRecordKind; rolled: number; kept: number }>;
};

function toDateKey(ts: string): string | null {
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

async function rollupFile(params: {
  filePath: string;
  kind: MissionControlRecordKind;
  rollupDir: string;
  cutoffMs: number;
  minBytes: number;
}): Promise<{ rolled: number; kept: number }> {
  let stat: { size: number } | null = null;
  try {
    stat = await fs.stat(params.filePath);
  } catch {
    return { rolled: 0, kept: 0 };
  }
  if (!stat || stat.size < params.minBytes) return { rolled: 0, kept: 0 };

  const handle = await fs.open(params.filePath, "r");
  const stream = handle.createReadStream({ encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const keepLines: string[] = [];
  let rolled = 0;
  let kept = 0;

  for await (const line of rl) {
    const trimmed = String(line ?? "").trim();
    if (!trimmed) continue;
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      keepLines.push(trimmed);
      kept += 1;
      continue;
    }
    const ts = typeof parsed.ts === "string" ? parsed.ts : "";
    const tsMs = Date.parse(ts);
    if (!Number.isFinite(tsMs)) {
      keepLines.push(trimmed);
      kept += 1;
      continue;
    }
    if (tsMs < params.cutoffMs) {
      const key = toDateKey(ts) ?? "unknown";
      const rollupPath = path.join(params.rollupDir, key, `${params.kind}.jsonl`);
      await fs.mkdir(path.dirname(rollupPath), { recursive: true });
      await fs.appendFile(rollupPath, `${trimmed}\n`);
      rolled += 1;
    } else {
      keepLines.push(trimmed);
      kept += 1;
    }
  }

  await rl.close();
  await stream.close();
  await handle.close();

  if (rolled > 0) {
    const tmpPath = `${params.filePath}.tmp`;
    await fs.writeFile(tmpPath, keepLines.join("\n") + (keepLines.length ? "\n" : ""));
    await fs.rename(tmpPath, params.filePath);
  }

  return { rolled, kept };
}

export async function rollupMissionControlLedgers(
  cfg: SurprisebotConfig,
  opts?: { keepDays?: number; minBytes?: number },
): Promise<MissionControlRollupResult> {
  const { files, dir } = resolveMissionControlPaths(cfg);
  const keepDays = Math.max(1, opts?.keepDays ?? DEFAULT_KEEP_DAYS);
  const minBytes = Math.max(0, opts?.minBytes ?? DEFAULT_MIN_BYTES);
  const cutoffMs = Date.now() - keepDays * DAY_MS;
  const rollupDir = path.join(dir, "rollups");

  const rolledKinds: Array<{ kind: MissionControlRecordKind; rolled: number; kept: number }> = [];
  for (const [kind, filePath] of Object.entries(files) as Array<[MissionControlRecordKind, string]>) {
    const result = await rollupFile({
      filePath,
      kind,
      rollupDir,
      cutoffMs,
      minBytes,
    });
    if (result.rolled > 0 || result.kept > 0) {
      rolledKinds.push({ kind, ...result });
    }
  }

  if (rolledKinds.length > 0) {
    log.info(
      `mission control rollup complete: ${rolledKinds
        .map((entry) => `${entry.kind} rolled=${entry.rolled} kept=${entry.kept}`)
        .join(" | ")}`,
    );
  }

  return { rolledKinds };
}
