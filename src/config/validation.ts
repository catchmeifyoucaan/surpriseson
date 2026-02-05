import path from "node:path";

import { findDuplicateAgentDirs, formatDuplicateAgentDirError } from "./agent-dirs.js";
import { resolveStateDir } from "./paths.js";
import { applyIdentityDefaults, applyModelDefaults, applySessionDefaults, applyMissionControlDefaults } from "./defaults.js";
import { findLegacyConfigIssues } from "./legacy.js";
import type { SurprisebotConfig, ConfigValidationIssue } from "./types.js";
import { SurprisebotSchema } from "./zod-schema.js";

function resolveWorkspacePath(cfg: SurprisebotConfig): string | null {
  const workspace = cfg.agents?.defaults?.workspace;
  if (!workspace || typeof workspace !== "string") return null;
  return workspace.replace(/^~\//, `${process.env.HOME ?? ""}/`);
}

function isPathWithin(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function assertWorkspaceOutsideStateDir(cfg: SurprisebotConfig): ConfigValidationIssue[] {
  const workspace = resolveWorkspacePath(cfg);
  if (!workspace) return [];
  if (process.env.SURPRISEBOT_ALLOW_UNSAFE_WORKSPACE) return [];
  const stateDir = resolveStateDir();
  try {
    const ws = path.resolve(workspace);
    const st = path.resolve(stateDir);
    if (isPathWithin(ws, st)) {
      return [
        {
          path: "agents.defaults.workspace",
          message: `Workspace must not live inside the state dir (${st}). Set a separate workspace or set SURPRISEBOT_ALLOW_UNSAFE_WORKSPACE=1 to override.`,
        },
      ];
    }
  } catch {
    return [];
  }
  return [];
}

export function validateConfigObject(
  raw: unknown,
): { ok: true; config: SurprisebotConfig } | { ok: false; issues: ConfigValidationIssue[] } {
  const legacyIssues = findLegacyConfigIssues(raw);
  if (legacyIssues.length > 0) {
    return {
      ok: false,
      issues: legacyIssues.map((iss) => ({
        path: iss.path,
        message: iss.message,
      })),
    };
  }
  const validated = SurprisebotSchema.safeParse(raw);
  if (!validated.success) {
    return {
      ok: false,
      issues: validated.error.issues.map((iss) => ({
        path: iss.path.join("."),
        message: iss.message,
      })),
    };
  }
  const duplicates = findDuplicateAgentDirs(validated.data as SurprisebotConfig);
  const workspaceIssues = assertWorkspaceOutsideStateDir(validated.data as SurprisebotConfig);
  if (duplicates.length > 0 || workspaceIssues.length > 0) {
    return {
      ok: false,
      issues: [
        ...(duplicates.length > 0
          ? [
              {
                path: "agents.list",
                message: formatDuplicateAgentDirError(duplicates),
              },
            ]
          : []),
        ...workspaceIssues,
      ],
    };
  }
  return {
    ok: true,
    config: applyModelDefaults(
      applySessionDefaults(applyMissionControlDefaults(applyIdentityDefaults(validated.data as SurprisebotConfig))),
    ),
  };
}
