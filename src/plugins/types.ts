import type { IncomingMessage, ServerResponse } from "node:http";
import type { Command } from "commander";

import type { AnyAgentTool } from "../agents/tools/common.js";
import type { ChannelDock } from "../channels/dock.js";
import type { ChannelPlugin } from "../channels/plugins/types.js";
import type { SurprisebotConfig } from "../config/config.js";
import type { GatewayRequestHandler } from "../gateway/server-methods/types.js";

export type PluginLogger = {
  debug?: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
};

export type PluginConfigUiHint = {
  label?: string;
  help?: string;
  advanced?: boolean;
  sensitive?: boolean;
  placeholder?: string;
};

export type PluginConfigValidation =
  | { ok: true; value?: unknown }
  | { ok: false; errors: string[] };

export type SurprisebotPluginConfigSchema = {
  safeParse?: (value: unknown) => {
    success: boolean;
    data?: unknown;
    error?: {
      issues?: Array<{ path: Array<string | number>; message: string }>;
    };
  };
  parse?: (value: unknown) => unknown;
  validate?: (value: unknown) => PluginConfigValidation;
  uiHints?: Record<string, PluginConfigUiHint>;
};

export type SurprisebotPluginToolContext = {
  config?: SurprisebotConfig;
  workspaceDir?: string;
  agentDir?: string;
  agentId?: string;
  sessionKey?: string;
  messageChannel?: string;
  agentAccountId?: string;
  sandboxed?: boolean;
};

export type SurprisebotPluginToolFactory = (
  ctx: SurprisebotPluginToolContext,
) => AnyAgentTool | AnyAgentTool[] | null | undefined;

export type SurprisebotPluginGatewayMethod = {
  method: string;
  handler: GatewayRequestHandler;
};

export type SurprisebotPluginHttpHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean> | boolean;

export type SurprisebotPluginCliContext = {
  program: Command;
  config: SurprisebotConfig;
  workspaceDir?: string;
  logger: PluginLogger;
};

export type SurprisebotPluginCliRegistrar = (ctx: SurprisebotPluginCliContext) => void | Promise<void>;

export type SurprisebotPluginServiceContext = {
  config: SurprisebotConfig;
  workspaceDir?: string;
  stateDir: string;
  logger: PluginLogger;
};

export type SurprisebotPluginService = {
  id: string;
  start: (ctx: SurprisebotPluginServiceContext) => void | Promise<void>;
  stop?: (ctx: SurprisebotPluginServiceContext) => void | Promise<void>;
};

export type SurprisebotPluginChannelRegistration = {
  plugin: ChannelPlugin;
  dock?: ChannelDock;
};

export type SurprisebotPluginDefinition = {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  configSchema?: SurprisebotPluginConfigSchema;
  register?: (api: SurprisebotPluginApi) => void | Promise<void>;
  activate?: (api: SurprisebotPluginApi) => void | Promise<void>;
};

export type SurprisebotPluginModule =
  | SurprisebotPluginDefinition
  | ((api: SurprisebotPluginApi) => void | Promise<void>);

export type SurprisebotPluginApi = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  config: SurprisebotConfig;
  pluginConfig?: Record<string, unknown>;
  logger: PluginLogger;
  registerTool: (
    tool: AnyAgentTool | SurprisebotPluginToolFactory,
    opts?: { name?: string; names?: string[] },
  ) => void;
  registerHttpHandler: (handler: SurprisebotPluginHttpHandler) => void;
  registerChannel: (registration: SurprisebotPluginChannelRegistration | ChannelPlugin) => void;
  registerGatewayMethod: (method: string, handler: GatewayRequestHandler) => void;
  registerCli: (registrar: SurprisebotPluginCliRegistrar, opts?: { commands?: string[] }) => void;
  registerService: (service: SurprisebotPluginService) => void;
  resolvePath: (input: string) => string;
};

export type PluginOrigin = "global" | "workspace" | "config";

export type PluginDiagnostic = {
  level: "warn" | "error";
  message: string;
  pluginId?: string;
  source?: string;
};
