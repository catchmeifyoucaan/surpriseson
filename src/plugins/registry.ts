import type { AnyAgentTool } from "../agents/tools/common.js";
import type { ChannelDock } from "../channels/dock.js";
import type { ChannelPlugin } from "../channels/plugins/types.js";
import type {
  GatewayRequestHandler,
  GatewayRequestHandlers,
} from "../gateway/server-methods/types.js";
import { resolveUserPath } from "../utils.js";
import type {
  SurprisebotPluginApi,
  SurprisebotPluginChannelRegistration,
  SurprisebotPluginCliRegistrar,
  SurprisebotPluginHttpHandler,
  SurprisebotPluginService,
  SurprisebotPluginToolContext,
  SurprisebotPluginToolFactory,
  PluginConfigUiHint,
  PluginDiagnostic,
  PluginLogger,
  PluginOrigin,
} from "./types.js";

export type PluginToolRegistration = {
  pluginId: string;
  factory: SurprisebotPluginToolFactory;
  names: string[];
  source: string;
};

export type PluginCliRegistration = {
  pluginId: string;
  register: SurprisebotPluginCliRegistrar;
  commands: string[];
  source: string;
};

export type PluginHttpRegistration = {
  pluginId: string;
  handler: SurprisebotPluginHttpHandler;
  source: string;
};

export type PluginChannelRegistration = {
  pluginId: string;
  plugin: ChannelPlugin;
  dock?: ChannelDock;
  source: string;
};

export type PluginServiceRegistration = {
  pluginId: string;
  service: SurprisebotPluginService;
  source: string;
};

export type PluginRecord = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  origin: PluginOrigin;
  workspaceDir?: string;
  enabled: boolean;
  status: "loaded" | "disabled" | "error";
  error?: string;
  toolNames: string[];
  channelIds: string[];
  gatewayMethods: string[];
  cliCommands: string[];
  services: string[];
  httpHandlers: number;
  configSchema: boolean;
  configUiHints?: Record<string, PluginConfigUiHint>;
};

export type PluginRegistry = {
  plugins: PluginRecord[];
  tools: PluginToolRegistration[];
  channels: PluginChannelRegistration[];
  gatewayHandlers: GatewayRequestHandlers;
  httpHandlers: PluginHttpRegistration[];
  cliRegistrars: PluginCliRegistration[];
  services: PluginServiceRegistration[];
  diagnostics: PluginDiagnostic[];
};

export type PluginRegistryParams = {
  logger: PluginLogger;
  coreGatewayHandlers?: GatewayRequestHandlers;
};

export function createPluginRegistry(registryParams: PluginRegistryParams) {
  const registry: PluginRegistry = {
    plugins: [],
    tools: [],
    channels: [],
    gatewayHandlers: {},
    httpHandlers: [],
    cliRegistrars: [],
    services: [],
    diagnostics: [],
  };
  const coreGatewayMethods = new Set(Object.keys(registryParams.coreGatewayHandlers ?? {}));

  const pushDiagnostic = (diag: PluginDiagnostic) => {
    registry.diagnostics.push(diag);
  };

  const registerTool = (
    record: PluginRecord,
    tool: AnyAgentTool | SurprisebotPluginToolFactory,
    opts?: { name?: string; names?: string[] },
  ) => {
    const names = opts?.names ?? (opts?.name ? [opts.name] : []);
    const factory: SurprisebotPluginToolFactory =
      typeof tool === "function" ? tool : (_ctx: SurprisebotPluginToolContext) => tool;

    if (typeof tool !== "function") {
      names.push(tool.name);
    }

    const normalized = names.map((name) => name.trim()).filter(Boolean);
    if (normalized.length > 0) {
      record.toolNames.push(...normalized);
    }
    registry.tools.push({
      pluginId: record.id,
      factory,
      names: normalized,
      source: record.source,
    });
  };

  const registerGatewayMethod = (
    record: PluginRecord,
    method: string,
    handler: GatewayRequestHandler,
  ) => {
    const trimmed = method.trim();
    if (!trimmed) return;
    if (coreGatewayMethods.has(trimmed) || registry.gatewayHandlers[trimmed]) {
      pushDiagnostic({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: `gateway method already registered: ${trimmed}`,
      });
      return;
    }
    registry.gatewayHandlers[trimmed] = handler;
    record.gatewayMethods.push(trimmed);
  };

  const registerHttpHandler = (record: PluginRecord, handler: SurprisebotPluginHttpHandler) => {
    record.httpHandlers += 1;
    registry.httpHandlers.push({
      pluginId: record.id,
      handler,
      source: record.source,
    });
  };

  const registerChannel = (
    record: PluginRecord,
    registration: SurprisebotPluginChannelRegistration | ChannelPlugin,
  ) => {
    const normalized =
      typeof (registration as SurprisebotPluginChannelRegistration).plugin === "object"
        ? (registration as SurprisebotPluginChannelRegistration)
        : { plugin: registration as ChannelPlugin };
    const plugin = normalized.plugin;
    const id = typeof plugin?.id === "string" ? plugin.id.trim() : String(plugin?.id ?? "").trim();
    if (!id) {
      pushDiagnostic({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: "channel registration missing id",
      });
      return;
    }
    record.channelIds.push(id);
    registry.channels.push({
      pluginId: record.id,
      plugin,
      dock: normalized.dock,
      source: record.source,
    });
  };

  const registerCli = (
    record: PluginRecord,
    registrar: SurprisebotPluginCliRegistrar,
    opts?: { commands?: string[] },
  ) => {
    const commands = (opts?.commands ?? []).map((cmd) => cmd.trim()).filter(Boolean);
    record.cliCommands.push(...commands);
    registry.cliRegistrars.push({
      pluginId: record.id,
      register: registrar,
      commands,
      source: record.source,
    });
  };

  const registerService = (record: PluginRecord, service: SurprisebotPluginService) => {
    const id = service.id.trim();
    if (!id) return;
    record.services.push(id);
    registry.services.push({
      pluginId: record.id,
      service,
      source: record.source,
    });
  };

  const normalizeLogger = (logger: PluginLogger): PluginLogger => ({
    info: logger.info,
    warn: logger.warn,
    error: logger.error,
    debug: logger.debug,
  });

  const createApi = (
    record: PluginRecord,
    params: {
      config: SurprisebotPluginApi["config"];
      pluginConfig?: Record<string, unknown>;
    },
  ): SurprisebotPluginApi => {
    return {
      id: record.id,
      name: record.name,
      version: record.version,
      description: record.description,
      source: record.source,
      config: params.config,
      pluginConfig: params.pluginConfig,
      logger: normalizeLogger(registryParams.logger),
      registerTool: (tool, opts) => registerTool(record, tool, opts),
      registerHttpHandler: (handler) => registerHttpHandler(record, handler),
      registerChannel: (registration) => registerChannel(record, registration),
      registerGatewayMethod: (method, handler) => registerGatewayMethod(record, method, handler),
      registerCli: (registrar, opts) => registerCli(record, registrar, opts),
      registerService: (service) => registerService(record, service),
      resolvePath: (input: string) => resolveUserPath(input),
    };
  };

  return {
    registry,
    createApi,
    pushDiagnostic,
    registerTool,
    registerChannel,
    registerGatewayMethod,
    registerCli,
    registerService,
  };
}
