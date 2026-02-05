import fs from "node:fs/promises";
import path from "node:path";

import type { SurprisebotConfig } from "../config/config.js";
import { resolveUserPath } from "../utils.js";
import { resolveAgentConfig } from "./agent-scope.js";
import {
  DEFAULT_MEMORY_GLOBAL_FILENAME,
  DEFAULT_MEMORY_GLOBAL_TEMPLATE,
  DEFAULT_MEMORY_PENDING_FILENAME,
  DEFAULT_MEMORY_PENDING_TEMPLATE,
  resolveDefaultAgentWorkspaceDir,
} from "./workspace.js";

export type SharedMemorySettings = {
  enabled: boolean;
  path: string;
  pendingPath: string;
  allowWriteAgents: string[];
};

export function resolveSharedMemorySettings(params: {
  cfg?: SurprisebotConfig;
  agentId?: string;
}): SharedMemorySettings | null {
  const cfg = params.cfg;
  if (!cfg) return null;
  const defaults = cfg.agents?.defaults?.sharedMemory;
  const overrides = params.agentId
    ? resolveAgentConfig(cfg, params.agentId)?.sharedMemory
    : undefined;
  const enabled = overrides?.enabled ?? defaults?.enabled ?? false;
  if (!enabled) return null;

  const defaultPath = path.join(resolveDefaultAgentWorkspaceDir(), DEFAULT_MEMORY_GLOBAL_FILENAME);
  const rawPath = (overrides?.path ?? defaults?.path ?? defaultPath).trim();
  const resolvedPath = resolveUserPath(rawPath);
  const pendingFallback = derivePendingPath(resolvedPath);
  const rawPending = (overrides?.pendingPath ?? defaults?.pendingPath ?? pendingFallback).trim();
  const pendingPath = resolveUserPath(rawPending);
  const allowWriteAgents = Array.isArray(overrides?.allowWriteAgents)
    ? overrides.allowWriteAgents
    : Array.isArray(defaults?.allowWriteAgents)
      ? defaults.allowWriteAgents
      : [];
  const filtered = allowWriteAgents.map((id) => id.trim()).filter(Boolean);

  return {
    enabled: true,
    path: resolvedPath,
    pendingPath,
    allowWriteAgents: filtered,
  };
}

function derivePendingPath(sharedPath: string): string {
  const dir = path.dirname(sharedPath);
  const base = path.basename(sharedPath);
  if (base.endsWith(".md")) {
    const stem = base.slice(0, -3);
    return path.join(dir, `${stem}.pending.md`);
  }
  return path.join(dir, path.basename(DEFAULT_MEMORY_PENDING_FILENAME));
}


export async function ensureSharedMemoryForWorkspace(params: {
  cfg: SurprisebotConfig;
  agentId: string;
  workspaceDir: string;
}): Promise<{ sharedPath: string; linkPath: string } | null> {
  const settings = resolveSharedMemorySettings({ cfg: params.cfg, agentId: params.agentId });
  if (!settings) return null;

  const sharedPath = settings.path;
  const pendingPath = settings.pendingPath;
  await fs.mkdir(path.dirname(sharedPath), { recursive: true });
  try {
    await fs.access(sharedPath);
  } catch {
    await fs.writeFile(sharedPath, DEFAULT_MEMORY_GLOBAL_TEMPLATE, "utf8");
  }

  await fs.mkdir(path.dirname(pendingPath), { recursive: true });
  try {
    await fs.access(pendingPath);
  } catch {
    await fs.writeFile(pendingPath, DEFAULT_MEMORY_PENDING_TEMPLATE, "utf8");
  }

  const linkPath = path.join(params.workspaceDir, DEFAULT_MEMORY_GLOBAL_FILENAME);
  const pendingLinkPath = path.join(params.workspaceDir, DEFAULT_MEMORY_PENDING_FILENAME);
  const normalizedShared = path.resolve(sharedPath);
  const normalizedLink = path.resolve(linkPath);

  if (normalizedShared === normalizedLink) {
    await ensurePendingLink({
      pendingPath,
      pendingLinkPath,
    });
    return { sharedPath, linkPath };
  }

  await fs.mkdir(path.dirname(linkPath), { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    const stat = await fs.lstat(linkPath);
    if (stat.isSymbolicLink()) {
      const current = await fs.readlink(linkPath);
      const resolved = path.resolve(path.dirname(linkPath), current);
      if (resolved === normalizedShared) {
        return { sharedPath, linkPath };
      }
      await fs.unlink(linkPath);
    } else {
      const backup = `${linkPath}.local.bak-${stamp}`;
      await fs.rename(linkPath, backup);
    }
  } catch {
    // link missing; create below
  }

  await fs.symlink(sharedPath, linkPath);
  await ensurePendingLink({
    pendingPath,
    pendingLinkPath,
  });
  return { sharedPath, linkPath };
}

async function ensurePendingLink(params: { pendingPath: string; pendingLinkPath: string }) {
  const { pendingPath, pendingLinkPath } = params;
  const normalizedPending = path.resolve(pendingPath);
  const normalizedLink = path.resolve(pendingLinkPath);
  if (normalizedPending === normalizedLink) return;
  await fs.mkdir(path.dirname(pendingLinkPath), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  try {
    const stat = await fs.lstat(pendingLinkPath);
    if (stat.isSymbolicLink()) {
      const current = await fs.readlink(pendingLinkPath);
      const resolved = path.resolve(path.dirname(pendingLinkPath), current);
      if (resolved === normalizedPending) return;
      await fs.unlink(pendingLinkPath);
    } else {
      const backup = `${pendingLinkPath}.local.bak-${stamp}`;
      await fs.rename(pendingLinkPath, backup);
    }
  } catch {
    // missing
  }
  await fs.symlink(pendingPath, pendingLinkPath);
}

export async function isSharedMemoryTarget(params: {
  filePath: string;
  workspaceDir: string;
  sharedPath: string;
}): Promise<boolean> {
  const raw = params.filePath.trim();
  if (!raw) return false;
  const target = path.isAbsolute(raw)
    ? path.normalize(raw)
    : path.resolve(params.workspaceDir, raw);
  const sharedAbs = path.resolve(params.sharedPath);
  const linkPath = path.resolve(params.workspaceDir, DEFAULT_MEMORY_GLOBAL_FILENAME);

  if (target === sharedAbs || target === linkPath) return true;

  try {
    const targetReal = await fs.realpath(target);
    const sharedReal = await fs.realpath(sharedAbs);
    if (targetReal === sharedReal) return true;
  } catch {
    // ignore missing paths
  }

  return false;
}
