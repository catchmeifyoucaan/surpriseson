import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import type { SurprisebotConfig } from "../../config/config.js";
import { resolveDefaultAgentId, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { appendMissionControlRecord } from "../mission-control/ledger.js";

export type ArtemisSyncResult = {
  ok: boolean;
  syncedFiles: string[];
};

function resolveWorkspaceDir(cfg: SurprisebotConfig): string {
  const agentId = resolveDefaultAgentId(cfg);
  return resolveAgentWorkspaceDir(cfg, agentId);
}

async function hashFile(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function copyIfExists(src: string, dest: string): Promise<boolean> {
  try {
    await fs.stat(src);
  } catch {
    return false;
  }
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
  return true;
}

export async function syncStanfordArtifacts(params: {
  cfg: SurprisebotConfig;
  runId: string;
  sessionDir: string;
}): Promise<ArtemisSyncResult> {
  const workspace = resolveWorkspaceDir(params.cfg);
  const destRoot = path.join(workspace, "research", "artemis", "sessions", params.runId);
  const syncedFiles: string[] = [];

  const candidates = [
    "supervisor.log",
    "supervisor_todo.json",
    "vulnerabilities_found.log",
  ];

  for (const filename of candidates) {
    const src = path.join(params.sessionDir, filename);
    const dest = path.join(destRoot, filename);
    const copied = await copyIfExists(src, dest);
    if (!copied) continue;
    syncedFiles.push(dest);
    const hash = await hashFile(dest);
    await appendMissionControlRecord({
      cfg: params.cfg,
      kind: "documents",
      record: {
        id: `doc-${params.runId}-${filename}`,
        ts: new Date().toISOString(),
        title: `ARTEMIS ${filename}`,
        docType: "artemis",
        path: dest,
        hash,
        meta: {
          runId: params.runId,
          sourcePath: src,
        },
      },
    });
  }

  const notesDir = path.join(params.sessionDir, "supervisor_notes");
  try {
    const entries = await fs.readdir(notesDir);
    for (const entry of entries) {
      const src = path.join(notesDir, entry);
      const dest = path.join(destRoot, "notes", entry);
      const copied = await copyIfExists(src, dest);
      if (!copied) continue;
      syncedFiles.push(dest);
      const hash = await hashFile(dest);
      await appendMissionControlRecord({
        cfg: params.cfg,
        kind: "documents",
        record: {
          id: `doc-${params.runId}-note-${entry}`,
          ts: new Date().toISOString(),
          title: `ARTEMIS note: ${entry}`,
          docType: "artemis-note",
          path: dest,
          hash,
          meta: {
            runId: params.runId,
            sourcePath: src,
          },
        },
      });
    }
  } catch {
    // notes are optional
  }

  return { ok: true, syncedFiles };
}
