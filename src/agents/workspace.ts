import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isSubagentSessionKey } from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";

export function resolveDefaultAgentWorkspaceDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const profile = env.SURPRISEBOT_PROFILE?.trim();
  const home = env.SURPRISEBOT_HOME?.trim();
  if (home) {
    const base = resolveUserPath(home);
    const suffix = profile && profile.toLowerCase() !== "default" ? `workspace-${profile}` : "workspace";
    return path.join(base, suffix);
  }
  if (profile && profile.toLowerCase() !== "default") {
    return path.join(homedir(), `surprisebot-${profile}`);
  }
  return path.join(homedir(), "surprisebot");
}

export const DEFAULT_AGENT_WORKSPACE_DIR = resolveDefaultAgentWorkspaceDir();
export const DEFAULT_AGENTS_FILENAME = "AGENTS.md";
export const DEFAULT_SOUL_FILENAME = "SOUL.md";
export const DEFAULT_TOOLS_FILENAME = "TOOLS.md";
export const DEFAULT_IDENTITY_FILENAME = "IDENTITY.md";
export const DEFAULT_USER_FILENAME = "USER.md";
export const DEFAULT_HEARTBEAT_FILENAME = "HEARTBEAT.md";
export const DEFAULT_BOOTSTRAP_FILENAME = "BOOTSTRAP.md";
export const DEFAULT_MEMORY_FILENAME = "MEMORY.md";
export const DEFAULT_MEMORY_PROFILE_FILENAME = "memory/profile.md";
export const DEFAULT_MEMORY_PREFERENCES_FILENAME = "memory/preferences.md";
export const DEFAULT_MEMORY_DECISIONS_FILENAME = "memory/decisions.md";
export const DEFAULT_MEMORY_ACTIVE_FILENAME = "memory/active.md";
export const DEFAULT_MEMORY_GLOBAL_FILENAME = "memory/shared.md";
export const DEFAULT_MEMORY_PENDING_FILENAME = "memory/shared.pending.md";

const DEFAULT_AGENTS_TEMPLATE = `# AGENTS.md - Surprisebot Workspace

This folder is the assistant's working directory.

## First run (one-time)
- If BOOTSTRAP.md exists, follow its ritual and delete it once complete.
- Your agent identity lives in IDENTITY.md.
- Your profile lives in USER.md.

## Backup tip (recommended)
If you treat this workspace as the agent's "memory", make it a git repo (ideally private) so identity
and notes are backed up.

\`\`\`bash
git init
git add AGENTS.md
git commit -m "Add agent workspace"
\`\`\`

## Safety defaults
- Don't exfiltrate secrets or private data.
- Don't run destructive commands unless explicitly asked.
- Be concise in chat; write longer output to files in this workspace.

## Daily memory (recommended)
- Keep a short daily log at memory/YYYY-MM-DD.md (create memory/ if needed).
- On session start, read today + yesterday if present.
- Capture durable facts, preferences, and decisions; avoid secrets.

## Shared memory (teamwide)
- Read memory/shared.md for durable cross-agent context.
- Subagents: propose updates in memory/shared.pending.md (do not edit shared.md).
- Core: mark approved lines with [APPROVED] and run /shared-review to merge.

## Heartbeats (optional)
- HEARTBEAT.md can hold a tiny checklist for heartbeat runs; keep it small.

## Customize
- Add your preferred style, rules, and "memory" here.
`;

const DEFAULT_SOUL_TEMPLATE = `# SOUL.md - Persona & Boundaries

Describe who the assistant is, tone, and boundaries.

- Keep replies concise and direct.
- Ask clarifying questions when needed.
- Never send streaming/partial replies to external messaging surfaces.
`;

const DEFAULT_TOOLS_TEMPLATE = `# TOOLS.md - User Tool Notes (editable)

This file is for *your* notes about external tools and conventions.
It does not define which tools exist; Surprisebot provides built-in tools internally.

## Examples

### imsg
- Send an iMessage/SMS: describe who/what, confirm before sending.
- Prefer short messages; avoid sending secrets.

### sag
- Text-to-speech: specify voice, target speaker/room, and whether to stream.

Add whatever else you want the assistant to know about your local toolchain.
`;

const DEFAULT_HEARTBEAT_TEMPLATE = `# HEARTBEAT.md

Keep this file empty unless you want a tiny checklist. Keep it small.
`;

const DEFAULT_BOOTSTRAP_TEMPLATE = `# BOOTSTRAP.md - First Run Ritual (delete after)

Hello. I was just born.

## Your mission
Start a short, playful conversation and learn:
- Who am I?
- What am I?
- Who are you?
- How should I call you?

## How to ask (cute + helpful)
Say:
"Hello! I was just born. Who am I? What am I? Who are you? How should I call you?"

Then offer suggestions:
- 3-5 name ideas.
- 3-5 creature/vibe combos.
- 5 emoji ideas.

## Write these files
After the user chooses, update:

1) IDENTITY.md
- Name
- Creature
- Vibe
- Emoji

2) USER.md
- Name
- Preferred address
- Pronouns (optional)
- Timezone (optional)
- Notes

3) ~/.surprisebot/surprisebot.json
Set identity.name, identity.theme, identity.emoji to match IDENTITY.md.

## Cleanup
Delete BOOTSTRAP.md once this is complete.
`;

const DEFAULT_IDENTITY_TEMPLATE = `# IDENTITY.md - Agent Identity

- Name:
- Creature:
- Vibe:
- Emoji:
`;

const DEFAULT_USER_TEMPLATE = `# USER.md - User Profile

- Name:
- Preferred address:
- Pronouns (optional):
- Timezone (optional):
- Notes:
`;

const DEFAULT_MEMORY_TEMPLATE = `# MEMORY.md

This file anchors durable memory for this workspace.
See memory/*.md for profile, preferences, decisions, and active goals.
`;

const DEFAULT_MEMORY_PROFILE_TEMPLATE = `# Profile
- Name:
- Role:
- Constraints:

## Preferences
- (add current preferences here)

## Notes
- (durable notes)
`;

const DEFAULT_MEMORY_PREFERENCES_TEMPLATE = `# Preference History
- YYYY-MM-DD PREF-YYYYMMDD-1 [ACTIVE]: (preference)
`;

const DEFAULT_MEMORY_DECISIONS_TEMPLATE = `# Decisions
- YYYY-MM-DD: Decision + rationale
`;

const DEFAULT_MEMORY_ACTIVE_TEMPLATE = `# Active
- Current goals and next steps
`;

export const DEFAULT_MEMORY_GLOBAL_TEMPLATE = `# Shared Memory (Global)
- High-signal facts shared across agents.
- Only the core agent should edit this file.
- Keep entries stable, concise, and dated when possible.
`;

export const DEFAULT_MEMORY_PENDING_TEMPLATE = `# Shared Memory (Pending)
- Subagents: propose shared memory updates here.
- Core agent: mark approved lines with [APPROVED] and run /shared-review to merge into shared.md.
- Keep proposals concise and dated.
`;

const TEMPLATE_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/templates",
);

function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) return content;
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) return content;
  const start = endIndex + "\n---".length;
  let trimmed = content.slice(start);
  trimmed = trimmed.replace(/^\s+/, "");
  return trimmed;
}

async function loadTemplate(name: string, fallback: string): Promise<string> {
  const templatePath = path.join(TEMPLATE_DIR, name);
  try {
    const content = await fs.readFile(templatePath, "utf-8");
    return stripFrontMatter(content);
  } catch {
    return fallback;
  }
}

export type WorkspaceBootstrapFileName =
  | typeof DEFAULT_AGENTS_FILENAME
  | typeof DEFAULT_SOUL_FILENAME
  | typeof DEFAULT_TOOLS_FILENAME
  | typeof DEFAULT_IDENTITY_FILENAME
  | typeof DEFAULT_USER_FILENAME
  | typeof DEFAULT_HEARTBEAT_FILENAME
  | typeof DEFAULT_BOOTSTRAP_FILENAME
  | typeof DEFAULT_MEMORY_FILENAME
  | typeof DEFAULT_MEMORY_PROFILE_FILENAME
  | typeof DEFAULT_MEMORY_PREFERENCES_FILENAME
  | typeof DEFAULT_MEMORY_DECISIONS_FILENAME
  | typeof DEFAULT_MEMORY_ACTIVE_FILENAME
  | typeof DEFAULT_MEMORY_GLOBAL_FILENAME
  | typeof DEFAULT_MEMORY_PENDING_FILENAME;

export type WorkspaceBootstrapFile = {
  name: WorkspaceBootstrapFileName;
  path: string;
  content?: string;
  missing: boolean;
};

async function writeFileIfMissing(filePath: string, content: string) {
  try {
    await fs.writeFile(filePath, content, {
      encoding: "utf-8",
      flag: "wx",
    });
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== "EEXIST") throw err;
  }
}

export async function ensureAgentWorkspace(params?: {
  dir?: string;
  ensureBootstrapFiles?: boolean;
}): Promise<{
  dir: string;
  agentsPath?: string;
  soulPath?: string;
  toolsPath?: string;
  identityPath?: string;
  userPath?: string;
  heartbeatPath?: string;
  bootstrapPath?: string;
}> {
  const rawDir = params?.dir?.trim() ? params.dir.trim() : DEFAULT_AGENT_WORKSPACE_DIR;
  const dir = resolveUserPath(rawDir);
  await fs.mkdir(dir, { recursive: true });

  if (!params?.ensureBootstrapFiles) return { dir };

  const agentsPath = path.join(dir, DEFAULT_AGENTS_FILENAME);
  const soulPath = path.join(dir, DEFAULT_SOUL_FILENAME);
  const toolsPath = path.join(dir, DEFAULT_TOOLS_FILENAME);
  const identityPath = path.join(dir, DEFAULT_IDENTITY_FILENAME);
  const userPath = path.join(dir, DEFAULT_USER_FILENAME);
  const heartbeatPath = path.join(dir, DEFAULT_HEARTBEAT_FILENAME);
  const bootstrapPath = path.join(dir, DEFAULT_BOOTSTRAP_FILENAME);
  const memoryPath = path.join(dir, DEFAULT_MEMORY_FILENAME);
  const memoryDir = path.join(dir, "memory");
  const memoryProfilePath = path.join(dir, DEFAULT_MEMORY_PROFILE_FILENAME);
  const memoryPreferencesPath = path.join(dir, DEFAULT_MEMORY_PREFERENCES_FILENAME);
  const memoryDecisionsPath = path.join(dir, DEFAULT_MEMORY_DECISIONS_FILENAME);
  const memoryActivePath = path.join(dir, DEFAULT_MEMORY_ACTIVE_FILENAME);
  const memoryGlobalPath = path.join(dir, DEFAULT_MEMORY_GLOBAL_FILENAME);
  const memoryPendingPath = path.join(dir, DEFAULT_MEMORY_PENDING_FILENAME);

  const isBrandNewWorkspace = await (async () => {
    const paths = [agentsPath, soulPath, toolsPath, identityPath, userPath, heartbeatPath];
    const existing = await Promise.all(
      paths.map(async (p) => {
        try {
          await fs.access(p);
          return true;
        } catch {
          return false;
        }
      }),
    );
    return existing.every((v) => !v);
  })();

  const agentsTemplate = await loadTemplate(DEFAULT_AGENTS_FILENAME, DEFAULT_AGENTS_TEMPLATE);
  const soulTemplate = await loadTemplate(DEFAULT_SOUL_FILENAME, DEFAULT_SOUL_TEMPLATE);
  const toolsTemplate = await loadTemplate(DEFAULT_TOOLS_FILENAME, DEFAULT_TOOLS_TEMPLATE);
  const identityTemplate = await loadTemplate(DEFAULT_IDENTITY_FILENAME, DEFAULT_IDENTITY_TEMPLATE);
  const userTemplate = await loadTemplate(DEFAULT_USER_FILENAME, DEFAULT_USER_TEMPLATE);
  const heartbeatTemplate = await loadTemplate(
    DEFAULT_HEARTBEAT_FILENAME,
    DEFAULT_HEARTBEAT_TEMPLATE,
  );
  const bootstrapTemplate = await loadTemplate(
    DEFAULT_BOOTSTRAP_FILENAME,
    DEFAULT_BOOTSTRAP_TEMPLATE,
  );
  const memoryTemplate = await loadTemplate(DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_TEMPLATE);
  const memoryProfileTemplate = await loadTemplate(
    DEFAULT_MEMORY_PROFILE_FILENAME,
    DEFAULT_MEMORY_PROFILE_TEMPLATE,
  );
  const memoryPreferencesTemplate = await loadTemplate(
    DEFAULT_MEMORY_PREFERENCES_FILENAME,
    DEFAULT_MEMORY_PREFERENCES_TEMPLATE,
  );
  const memoryDecisionsTemplate = await loadTemplate(
    DEFAULT_MEMORY_DECISIONS_FILENAME,
    DEFAULT_MEMORY_DECISIONS_TEMPLATE,
  );
  const memoryActiveTemplate = await loadTemplate(
    DEFAULT_MEMORY_ACTIVE_FILENAME,
    DEFAULT_MEMORY_ACTIVE_TEMPLATE,
  );
  const memoryGlobalTemplate = await loadTemplate(
    DEFAULT_MEMORY_GLOBAL_FILENAME,
    DEFAULT_MEMORY_GLOBAL_TEMPLATE,
  );
  const memoryPendingTemplate = await loadTemplate(
    DEFAULT_MEMORY_PENDING_FILENAME,
    DEFAULT_MEMORY_PENDING_TEMPLATE,
  );

  await writeFileIfMissing(agentsPath, agentsTemplate);
  await writeFileIfMissing(soulPath, soulTemplate);
  await writeFileIfMissing(toolsPath, toolsTemplate);
  await writeFileIfMissing(identityPath, identityTemplate);
  await writeFileIfMissing(userPath, userTemplate);
  await writeFileIfMissing(heartbeatPath, heartbeatTemplate);
  if (isBrandNewWorkspace) {
    await writeFileIfMissing(bootstrapPath, bootstrapTemplate);
  }
  await writeFileIfMissing(memoryPath, memoryTemplate);
  await fs.mkdir(memoryDir, { recursive: true });
  await writeFileIfMissing(memoryProfilePath, memoryProfileTemplate);
  await writeFileIfMissing(memoryPreferencesPath, memoryPreferencesTemplate);
  await writeFileIfMissing(memoryDecisionsPath, memoryDecisionsTemplate);
  await writeFileIfMissing(memoryActivePath, memoryActiveTemplate);
  await writeFileIfMissing(memoryGlobalPath, memoryGlobalTemplate);
  await writeFileIfMissing(memoryPendingPath, memoryPendingTemplate);

  return {
    dir,
    agentsPath,
    soulPath,
    toolsPath,
    identityPath,
    userPath,
    heartbeatPath,
    bootstrapPath,
  };
}

export async function loadWorkspaceBootstrapFiles(dir: string): Promise<WorkspaceBootstrapFile[]> {
  const resolvedDir = resolveUserPath(dir);

  const entries: Array<{
    name: WorkspaceBootstrapFileName;
    filePath: string;
  }> = [
    {
      name: DEFAULT_AGENTS_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_AGENTS_FILENAME),
    },
    {
      name: DEFAULT_SOUL_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_SOUL_FILENAME),
    },
    {
      name: DEFAULT_TOOLS_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_TOOLS_FILENAME),
    },
    {
      name: DEFAULT_IDENTITY_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_IDENTITY_FILENAME),
    },
    {
      name: DEFAULT_USER_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_USER_FILENAME),
    },
    {
      name: DEFAULT_HEARTBEAT_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_HEARTBEAT_FILENAME),
    },
    {
      name: DEFAULT_BOOTSTRAP_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_BOOTSTRAP_FILENAME),
    },
    {
      name: DEFAULT_MEMORY_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_MEMORY_FILENAME),
    },
    {
      name: DEFAULT_MEMORY_PROFILE_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_MEMORY_PROFILE_FILENAME),
    },
    {
      name: DEFAULT_MEMORY_PREFERENCES_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_MEMORY_PREFERENCES_FILENAME),
    },
    {
      name: DEFAULT_MEMORY_DECISIONS_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_MEMORY_DECISIONS_FILENAME),
    },
    {
      name: DEFAULT_MEMORY_ACTIVE_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_MEMORY_ACTIVE_FILENAME),
    },
    {
      name: DEFAULT_MEMORY_GLOBAL_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_MEMORY_GLOBAL_FILENAME),
    },
    {
      name: DEFAULT_MEMORY_PENDING_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_MEMORY_PENDING_FILENAME),
    },
  ];

  const result: WorkspaceBootstrapFile[] = [];
  for (const entry of entries) {
    try {
      const content = await fs.readFile(entry.filePath, "utf-8");
      result.push({
        name: entry.name,
        path: entry.filePath,
        content,
        missing: false,
      });
    } catch {
      result.push({ name: entry.name, path: entry.filePath, missing: true });
    }
  }
  return result;
}

const SUBAGENT_BOOTSTRAP_ALLOWLIST = new Set([
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_MEMORY_GLOBAL_FILENAME,
]);

export function filterBootstrapFilesForSession(
  files: WorkspaceBootstrapFile[],
  sessionKey?: string,
): WorkspaceBootstrapFile[] {
  if (!sessionKey || !isSubagentSessionKey(sessionKey)) return files;
  return files.filter((file) => SUBAGENT_BOOTSTRAP_ALLOWLIST.has(file.name));
}
