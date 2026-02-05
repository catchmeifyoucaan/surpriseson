import {
  codingTools,
  createEditTool,
  createReadTool,
  createWriteTool,
  readTool,
} from "@mariozechner/pi-coding-agent";
import type { SurprisebotConfig } from "../config/config.js";
import { resolveDefaultAgentId } from "./agent-scope.js";
import { isSubagentSessionKey } from "../routing/session-key.js";
import { resolveGatewayMessageChannel } from "../utils/message-channel.js";
import { createApplyPatchTool } from "./apply-patch.js";
import {
  createExecTool,
  createProcessTool,
  type ExecToolDefaults,
  type ProcessToolDefaults,
} from "./bash-tools.js";
import { listChannelAgentTools } from "./channel-tools.js";
import { createSurprisebotTools } from "./surprisebot-tools.js";
import { isSharedMemoryTarget, resolveSharedMemorySettings } from "./shared-memory.js";
import type { ModelAuthMode } from "./model-auth.js";
import { wrapToolWithAbortSignal } from "./pi-tools.abort.js";
import {
  filterToolsByPolicy,
  isToolAllowedByPolicies,
  resolveEffectiveToolPolicy,
  resolveSubagentToolPolicy,
} from "./pi-tools.policy.js";
import {
  assertRequiredParams,
  CLAUDE_PARAM_GROUPS,
  createSurprisebotReadTool,
  createSandboxedEditTool,
  createSandboxedReadTool,
  createSandboxedWriteTool,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolParamNormalization,
} from "./pi-tools.read.js";
import { cleanToolSchemaForGemini, normalizeToolParameters } from "./pi-tools.schema.js";
import type { AnyAgentTool } from "./pi-tools.types.js";
import type { SandboxContext } from "./sandbox.js";
import { resolveToolProfilePolicy } from "./tool-policy.js";

function isOpenAIProvider(provider?: string) {
  const normalized = provider?.trim().toLowerCase();
  return normalized === "openai" || normalized === "openai-codex";
}

function isApplyPatchAllowedForModel(params: {
  modelProvider?: string;
  modelId?: string;
  allowModels?: string[];
}) {
  const allowModels = Array.isArray(params.allowModels) ? params.allowModels : [];
  if (allowModels.length === 0) return true;
  const modelId = params.modelId?.trim();
  if (!modelId) return false;
  const normalizedModelId = modelId.toLowerCase();
  const provider = params.modelProvider?.trim().toLowerCase();
  const normalizedFull =
    provider && !normalizedModelId.includes("/")
      ? `${provider}/${normalizedModelId}`
      : normalizedModelId;
  return allowModels.some((entry) => {
    const normalized = entry.trim().toLowerCase();
    if (!normalized) return false;
    return normalized === normalizedModelId || normalized === normalizedFull;
  });
}

export const __testing = {
  cleanToolSchemaForGemini,
  normalizeToolParams,
  patchToolSchemaForClaudeCompatibility,
  wrapToolParamNormalization,
  assertRequiredParams,
} as const;

function normalizeAgentIdForCompare(value?: string): string {
  return (value ?? "").trim().toLowerCase();
}

function resolveSharedMemoryWritePolicy(params: {
  config?: SurprisebotConfig;
  agentId?: string;
}): { sharedPath?: string; allowWrite: boolean } {
  const cfg = params.config;
  if (!cfg) return { sharedPath: undefined, allowWrite: true };
  const resolvedAgentId = params.agentId ?? resolveDefaultAgentId(cfg);
  const settings = resolveSharedMemorySettings({ cfg, agentId: resolvedAgentId });
  if (!settings) return { sharedPath: undefined, allowWrite: true };
  const allowList = settings.allowWriteAgents
    .map((entry) => normalizeAgentIdForCompare(entry))
    .filter(Boolean);
  const resolvedDefault = resolveDefaultAgentId(cfg);
  const allowed =
    allowList.length > 0
      ? allowList.includes(normalizeAgentIdForCompare(resolvedAgentId))
      : normalizeAgentIdForCompare(resolvedAgentId) ===
          normalizeAgentIdForCompare(resolvedDefault);
  return { sharedPath: settings.path, allowWrite: allowed };
}

async function assertSharedMemoryWriteAllowed(params: {
  filePath?: string;
  workspaceDir: string;
  sharedPath?: string;
  allowWrite: boolean;
  toolName: string;
}): Promise<void> {
  if (!params.sharedPath || params.allowWrite) return;
  if (!params.filePath) return;
  const hit = await isSharedMemoryTarget({
    filePath: params.filePath,
    workspaceDir: params.workspaceDir,
    sharedPath: params.sharedPath,
  });
  if (!hit) return;
  throw new Error(
    `${params.toolName}: shared memory is read-only for this agent. Ask the core agent to update it.`,
  );
}

function wrapSharedMemoryWriteGuard(
  tool: AnyAgentTool,
  opts: { sharedPath?: string; allowWrite: boolean; workspaceDir: string },
): AnyAgentTool {
  if (!opts.sharedPath || opts.allowWrite) return tool;
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const normalized = normalizeToolParams(params);
      const record =
        normalized ??
        (params && typeof params === "object"
          ? (params as Record<string, unknown>)
          : undefined);
      const filePath =
        typeof record?.path === "string"
          ? record.path
          : typeof record?.file_path === "string"
            ? record.file_path
            : undefined;
      await assertSharedMemoryWriteAllowed({
        filePath,
        workspaceDir: opts.workspaceDir,
        sharedPath: opts.sharedPath,
        allowWrite: opts.allowWrite,
        toolName: tool.name,
      });
      return tool.execute(toolCallId, normalized ?? params, signal, onUpdate);
    },
  };
}

function extractPatchPaths(input: string): string[] {
  const paths = new Set<string>();
  const lines = input.split(/\r?\n/);
  const patterns = [
    "*** Add File: ",
    "*** Update File: ",
    "*** Delete File: ",
    "*** Move to: ",
  ];
  for (const line of lines) {
    const trimmed = line.trim();
    for (const prefix of patterns) {
      if (trimmed.startsWith(prefix)) {
        const value = trimmed.slice(prefix.length).trim();
        if (value) paths.add(value);
      }
    }
  }
  return [...paths];
}

function wrapSharedMemoryPatchGuard(
  tool: AnyAgentTool,
  opts: { sharedPath?: string; allowWrite: boolean; workspaceDir: string },
): AnyAgentTool {
  if (!opts.sharedPath || opts.allowWrite) return tool;
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const record =
        params && typeof params === "object"
          ? (params as Record<string, unknown>)
          : undefined;
      const input = typeof record?.input === "string" ? record.input : "";
      if (input.trim()) {
        const paths = extractPatchPaths(input);
        for (const filePath of paths) {
          await assertSharedMemoryWriteAllowed({
            filePath,
            workspaceDir: opts.workspaceDir,
            sharedPath: opts.sharedPath,
            allowWrite: opts.allowWrite,
            toolName: tool.name,
          });
        }
      }
      return tool.execute(toolCallId, params, signal, onUpdate);
    },
  };
}

export function createSurprisebotCodingTools(options?: {
  exec?: ExecToolDefaults & ProcessToolDefaults;
  messageProvider?: string;
  agentAccountId?: string;
  sandbox?: SandboxContext | null;
  sessionKey?: string;
  agentDir?: string;
  workspaceDir?: string;
  config?: SurprisebotConfig;
  abortSignal?: AbortSignal;
  /**
   * Provider of the currently selected model (used for provider-specific tool quirks).
   * Example: "anthropic", "openai", "google", "openai-codex".
   */
  modelProvider?: string;
  /** Model id for the current provider (used for model-specific tool gating). */
  modelId?: string;
  /**
   * Auth mode for the current provider. We only need this for Anthropic OAuth
   * tool-name blocking quirks.
   */
  modelAuthMode?: ModelAuthMode;
  /** Current channel ID for auto-threading (Slack). */
  currentChannelId?: string;
  /** Current thread timestamp for auto-threading (Slack). */
  currentThreadTs?: string;
  /** Reply-to mode for Slack auto-threading. */
  replyToMode?: "off" | "first" | "all";
  /** Mutable ref to track if a reply was sent (for "first" mode). */
  hasRepliedRef?: { value: boolean };
}): AnyAgentTool[] {
  const execToolName = "exec";
  const sandbox = options?.sandbox?.enabled ? options.sandbox : undefined;
  const {
    agentId,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    profile,
    providerProfile,
  } = resolveEffectiveToolPolicy({
    config: options?.config,
    sessionKey: options?.sessionKey,
    modelProvider: options?.modelProvider,
    modelId: options?.modelId,
  });
  const resolvedAgentId = agentId ?? (options?.config ? resolveDefaultAgentId(options.config) : undefined);
  const sharedMemoryPolicy = resolveSharedMemoryWritePolicy({
    config: options?.config,
    agentId: resolvedAgentId,
  });
  const profilePolicy = resolveToolProfilePolicy(profile);
  const providerProfilePolicy = resolveToolProfilePolicy(providerProfile);
  const scopeKey = options?.exec?.scopeKey ?? (agentId ? `agent:${agentId}` : undefined);
  const subagentPolicy =
    isSubagentSessionKey(options?.sessionKey) && options?.sessionKey
      ? resolveSubagentToolPolicy(options.config)
      : undefined;
  const allowBackground = isToolAllowedByPolicies("process", [
    profilePolicy,
    providerProfilePolicy,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    sandbox?.tools,
    subagentPolicy,
  ]);
  const sandboxRoot = sandbox?.workspaceDir;
  const allowWorkspaceWrites = sandbox?.workspaceAccess !== "ro";
  const workspaceRoot = options?.workspaceDir ?? process.cwd();
  const applyPatchConfig = options?.config?.tools?.exec?.applyPatch;
  const applyPatchEnabled =
    !!applyPatchConfig?.enabled &&
    isOpenAIProvider(options?.modelProvider) &&
    isApplyPatchAllowedForModel({
      modelProvider: options?.modelProvider,
      modelId: options?.modelId,
      allowModels: applyPatchConfig?.allowModels,
    });

  const base = (codingTools as unknown as AnyAgentTool[]).flatMap((tool) => {
    if (tool.name === readTool.name) {
      if (sandboxRoot) {
        return [createSandboxedReadTool(sandboxRoot)];
      }
      const freshReadTool = createReadTool(workspaceRoot);
      return [createSurprisebotReadTool(freshReadTool, { workspaceRoot })];
    }
    if (tool.name === "bash" || tool.name === execToolName) return [];
    if (tool.name === "write") {
      if (sandboxRoot) return [];
      // Wrap with param normalization for Claude Code compatibility
      const writeTool = wrapToolParamNormalization(
        createWriteTool(workspaceRoot),
        CLAUDE_PARAM_GROUPS.write,
      );
      return [
        wrapSharedMemoryWriteGuard(writeTool, {
          sharedPath: sharedMemoryPolicy.sharedPath,
          allowWrite: sharedMemoryPolicy.allowWrite,
          workspaceDir: workspaceRoot,
        }),
      ];
    }
    if (tool.name === "edit") {
      if (sandboxRoot) return [];
      // Wrap with param normalization for Claude Code compatibility
      const editTool = wrapToolParamNormalization(
        createEditTool(workspaceRoot),
        CLAUDE_PARAM_GROUPS.edit,
      );
      return [
        wrapSharedMemoryWriteGuard(editTool, {
          sharedPath: sharedMemoryPolicy.sharedPath,
          allowWrite: sharedMemoryPolicy.allowWrite,
          workspaceDir: workspaceRoot,
        }),
      ];
    }
    return [tool as AnyAgentTool];
  });
  const execTool = createExecTool({
    ...options?.exec,
    cwd: options?.workspaceDir,
    allowBackground,
    scopeKey,
    sandbox: sandbox
      ? {
          containerName: sandbox.containerName,
          workspaceDir: sandbox.workspaceDir,
          containerWorkdir: sandbox.containerWorkdir,
          env: sandbox.docker.env,
        }
      : undefined,
  });
  const bashTool = {
    ...(execTool as unknown as AnyAgentTool),
    name: "bash",
    label: "bash",
  } satisfies AnyAgentTool;
  const processTool = createProcessTool({
    cleanupMs: options?.exec?.cleanupMs,
    scopeKey,
  });
  const applyPatchTool =
    !applyPatchEnabled || (sandboxRoot && !allowWorkspaceWrites)
      ? null
      : createApplyPatchTool({
          cwd: sandboxRoot ?? workspaceRoot,
          sandboxRoot: sandboxRoot && allowWorkspaceWrites ? sandboxRoot : undefined,
        });
  const guardedApplyPatchTool = applyPatchTool
    ? wrapSharedMemoryPatchGuard(applyPatchTool as unknown as AnyAgentTool, {
        sharedPath: sharedMemoryPolicy.sharedPath,
        allowWrite: sharedMemoryPolicy.allowWrite,
        workspaceDir: workspaceRoot,
      })
    : null;
  const tools: AnyAgentTool[] = [
    ...base,
    ...(sandboxRoot
      ? allowWorkspaceWrites
        ? [createSandboxedEditTool(sandboxRoot), createSandboxedWriteTool(sandboxRoot)]
        : []
      : []),
    ...(guardedApplyPatchTool ? [guardedApplyPatchTool as AnyAgentTool] : []),
    execTool as unknown as AnyAgentTool,
    bashTool,
    processTool as unknown as AnyAgentTool,
    // Channel docking: include channel-defined agent tools (login, etc.).
    ...listChannelAgentTools({ cfg: options?.config }),
    ...createSurprisebotTools({
      browserControlUrl: sandbox?.browser?.controlUrl,
      allowHostBrowserControl: sandbox ? sandbox.browserAllowHostControl : true,
      allowedControlUrls: sandbox?.browserAllowedControlUrls,
      allowedControlHosts: sandbox?.browserAllowedControlHosts,
      allowedControlPorts: sandbox?.browserAllowedControlPorts,
      agentSessionKey: options?.sessionKey,
      agentChannel: resolveGatewayMessageChannel(options?.messageProvider),
      agentAccountId: options?.agentAccountId,
      agentDir: options?.agentDir,
      sandboxRoot,
      workspaceDir: options?.workspaceDir,
      sandboxed: !!sandbox,
      config: options?.config,
      currentChannelId: options?.currentChannelId,
      currentThreadTs: options?.currentThreadTs,
      replyToMode: options?.replyToMode,
      hasRepliedRef: options?.hasRepliedRef,
    }),
  ];
  const toolsFiltered = profilePolicy ? filterToolsByPolicy(tools, profilePolicy) : tools;
  const providerProfileFiltered = providerProfilePolicy
    ? filterToolsByPolicy(toolsFiltered, providerProfilePolicy)
    : toolsFiltered;
  const globalFiltered = globalPolicy
    ? filterToolsByPolicy(providerProfileFiltered, globalPolicy)
    : providerProfileFiltered;
  const globalProviderFiltered = globalProviderPolicy
    ? filterToolsByPolicy(globalFiltered, globalProviderPolicy)
    : globalFiltered;
  const agentFiltered = agentPolicy
    ? filterToolsByPolicy(globalProviderFiltered, agentPolicy)
    : globalProviderFiltered;
  const agentProviderFiltered = agentProviderPolicy
    ? filterToolsByPolicy(agentFiltered, agentProviderPolicy)
    : agentFiltered;
  const sandboxed = sandbox
    ? filterToolsByPolicy(agentProviderFiltered, sandbox.tools)
    : agentProviderFiltered;
  const subagentFiltered = subagentPolicy
    ? filterToolsByPolicy(sandboxed, subagentPolicy)
    : sandboxed;
  // Always normalize tool JSON Schemas before handing them to pi-agent/pi-ai.
  // Without this, some providers (notably OpenAI) will reject root-level union schemas.
  const normalized = subagentFiltered.map(normalizeToolParameters);
  const withAbort = options?.abortSignal
    ? normalized.map((tool) => wrapToolWithAbortSignal(tool, options.abortSignal))
    : normalized;

  // NOTE: Keep canonical (lowercase) tool names here.
  // pi-ai's Anthropic OAuth transport remaps tool names to Claude Code-style names
  // on the wire and maps them back for tool dispatch.
  return withAbort;
}
