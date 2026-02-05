import path from "node:path";

import { VERSION } from "../version.js";
import {
  GATEWAY_SERVICE_KIND,
  GATEWAY_SERVICE_MARKER,
  resolveGatewayLaunchAgentLabel,
  resolveGatewaySystemdServiceName,
} from "./constants.js";

export type MinimalServicePathOptions = {
  platform?: NodeJS.Platform;
  extraDirs?: string[];
};

type BuildServicePathOptions = MinimalServicePathOptions & {
  env?: Record<string, string | undefined>;
};

function resolveSystemPathDirs(platform: NodeJS.Platform): string[] {
  if (platform === "darwin") {
    return ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  }
  if (platform === "linux") {
    return ["/usr/local/bin", "/usr/bin", "/bin"];
  }
  return [];
}

export function getMinimalServicePathParts(options: MinimalServicePathOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") return [];

  const parts: string[] = [];
  const extraDirs = options.extraDirs ?? [];
  const systemDirs = resolveSystemPathDirs(platform);

  const add = (dir: string) => {
    if (!dir) return;
    if (!parts.includes(dir)) parts.push(dir);
  };

  for (const dir of extraDirs) add(dir);
  for (const dir of systemDirs) add(dir);

  return parts;
}

export function buildMinimalServicePath(options: BuildServicePathOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return env.PATH ?? "";
  }

  return getMinimalServicePathParts(options).join(path.delimiter);
}

export function buildServiceEnvironment(params: {
  env: Record<string, string | undefined>;
  port: number;
  token?: string;
  launchdLabel?: string;
}): Record<string, string | undefined> {
  const { env, port, token, launchdLabel } = params;
  const profile = env.SURPRISEBOT_PROFILE;
  const resolvedLaunchdLabel =
    launchdLabel ||
    (process.platform === "darwin" ? resolveGatewayLaunchAgentLabel(profile) : undefined);
  const systemdUnit = `${resolveGatewaySystemdServiceName(profile)}.service`;
  return {
    PATH: buildMinimalServicePath({ env }),
    SURPRISEBOT_PROFILE: profile,
    SURPRISEBOT_STATE_DIR: env.SURPRISEBOT_STATE_DIR,
    SURPRISEBOT_CONFIG_PATH: env.SURPRISEBOT_CONFIG_PATH,
    SURPRISEBOT_GATEWAY_PORT: String(port),
    SURPRISEBOT_GATEWAY_TOKEN: token,
    SURPRISEBOT_LAUNCHD_LABEL: resolvedLaunchdLabel,
    SURPRISEBOT_SYSTEMD_UNIT: systemdUnit,
    SURPRISEBOT_SERVICE_MARKER: GATEWAY_SERVICE_MARKER,
    SURPRISEBOT_SERVICE_KIND: GATEWAY_SERVICE_KIND,
    SURPRISEBOT_SERVICE_VERSION: VERSION,
  };
}
