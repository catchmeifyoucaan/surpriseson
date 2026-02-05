import os from "node:os";
import path from "node:path";

import { runCommandWithTimeout } from "../process/exec.js";

export type SystemHealthCheck = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  details: {
    totalMemGb: number;
    freeMemGb: number;
    minRamGb: number;
    minDiskGb: number;
    diskFreeByPath: Record<string, number | null>
    cpuCount: number;
    load1: number;
  };
};

export type SystemHealthOptions = {
  minRamGb?: number;
  minDiskGb?: number;
  paths?: string[];
};

function toGb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100;
}

async function getDiskFreeGb(targetPath: string): Promise<number | null> {
  if (process.platform === "win32") return null;
  const safePath = path.resolve(targetPath);
  const res = await runCommandWithTimeout(["df", "-Pk", safePath], { timeoutMs: 8_000 });
  if (res.code !== 0) return null;
  const lines = res.stdout.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return null;
  const line = lines[lines.length - 1];
  const parts = line.trim().split(/\s+/);
  if (parts.length < 6) return null;
  const availableKb = Number(parts[3]);
  if (!Number.isFinite(availableKb)) return null;
  return Math.round((availableKb / 1024 / 1024) * 100) / 100;
}

export async function checkSystemHealth(opts: SystemHealthOptions = {}): Promise<SystemHealthCheck> {
  const minRamGb = opts.minRamGb ?? 1;
  const minDiskGb = opts.minDiskGb ?? 5;
  const paths = (opts.paths && opts.paths.length > 0 ? opts.paths : [process.cwd()]).map((p) =>
    path.resolve(p),
  );

  const totalMemGb = toGb(os.totalmem());
  const cpuCount = os.cpus().length;
  const load1 = Array.isArray(os.loadavg()) ? os.loadavg()[0] : 0;
  const freeMemGb = toGb(os.freemem());

  const errors: string[] = [];
  const warnings: string[] = [];

  if (totalMemGb < minRamGb) {
    errors.push(`RAM too low: ${totalMemGb} GiB total (min ${minRamGb} GiB).`);
  }

  if (freeMemGb < Math.max(0.25, minRamGb * 0.1)) {
    warnings.push(`Low free RAM: ${freeMemGb} GiB available.`);
  }


  if (cpuCount < 2) {
    warnings.push(`Low CPU count: ${cpuCount} core(s).`);
  }
  if (load1 && load1 > cpuCount * 2) {
    warnings.push(`High 1m load: ${load1.toFixed(2)} (cores ${cpuCount}).`);
  }

  const diskFreeByPath: Record<string, number | null> = {};
  for (const p of paths) {
    try {
      const freeGb = await getDiskFreeGb(p);
      diskFreeByPath[p] = freeGb;
      if (freeGb === null) {
        warnings.push(`Disk check unavailable for ${p}.`);
        continue;
      }
      if (freeGb < minDiskGb) {
        errors.push(`Disk space too low at ${p}: ${freeGb} GiB free (min ${minDiskGb} GiB).`);
      }
    } catch (err) {
      diskFreeByPath[p] = null;
      warnings.push(`Disk check failed for ${p}: ${String(err)}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    details: {
      totalMemGb,
      freeMemGb,
      minRamGb,
      minDiskGb,
      diskFreeByPath,
    cpuCount,
    load1,
    },
  };
}

export function formatSystemHealthSummary(check: SystemHealthCheck): string[] {
  const lines: string[] = [];
  lines.push(`RAM total: ${check.details.totalMemGb} GiB (min ${check.details.minRamGb} GiB)`);
  lines.push(`CPU cores: ${check.details.cpuCount} (load1: ${check.details.load1.toFixed(2)})`);
  lines.push(`RAM free: ${check.details.freeMemGb} GiB`);
  for (const [p, free] of Object.entries(check.details.diskFreeByPath)) {
    lines.push(
      free === null
        ? `Disk free (${p}): unavailable`
        : `Disk free (${p}): ${free} GiB (min ${check.details.minDiskGb} GiB)`,
    );
  }
  return lines;
}
