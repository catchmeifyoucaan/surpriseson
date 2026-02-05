import os from "node:os";
import path from "node:path";
import type { SurprisebotConfig } from "./types.js";

/**
 * Nix mode detection: When SURPRISEBOT_NIX_MODE=1, the gateway is running under Nix.
 * In this mode:
 * - No auto-install flows should be attempted
 * - Missing dependencies should produce actionable Nix-specific error messages
 * - Config is managed externally (read-only from Nix perspective)
 */
export function resolveIsNixMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SURPRISEBOT_NIX_MODE === "1";
}

export const isNixMode = resolveIsNixMode();


/**
 * Base Surprisebot home directory for a combined state/workspace layout.
 * Set via SURPRISEBOT_HOME. Example layout:
 *   $SURPRISEBOT_HOME/state
 *   $SURPRISEBOT_HOME/workspace
 */
export function resolveSurprisebotHome(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string | null {
  const override = env.SURPRISEBOT_HOME?.trim();
  if (!override) return null;
  return resolveUserPath(override);
}

/**
 * State directory for mutable data (sessions, logs, caches).
 * Can be overridden via SURPRISEBOT_STATE_DIR environment variable.
 * Default: ~/.surprisebot
 */
export function resolveStateDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const override = env.SURPRISEBOT_STATE_DIR?.trim();
  if (override) return resolveUserPath(override);
  const home = resolveSurprisebotHome(env, homedir);
  if (home) return path.join(home, "state");
  return path.join(homedir(), ".surprisebot");
}

function resolveUserPath(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith("~")) {
    const expanded = trimmed.replace(/^~(?=$|[\\/])/, os.homedir());
    return path.resolve(expanded);
  }
  return path.resolve(trimmed);
}

export const STATE_DIR_SURPRISEBOT = resolveStateDir();

/**
 * Config file path (JSON5).
 * Can be overridden via SURPRISEBOT_CONFIG_PATH environment variable.
 * Default: ~/.surprisebot/surprisebot.json (or $SURPRISEBOT_STATE_DIR/surprisebot.json)
 */
export function resolveConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  const override = env.SURPRISEBOT_CONFIG_PATH?.trim();
  if (override) return resolveUserPath(override);
  return path.join(stateDir, "surprisebot.json");
}

export const CONFIG_PATH_SURPRISEBOT = resolveConfigPath();

export const DEFAULT_GATEWAY_PORT = 18789;

const OAUTH_FILENAME = "oauth.json";

/**
 * OAuth credentials storage directory.
 *
 * Precedence:
 * - `SURPRISEBOT_OAUTH_DIR` (explicit override)
 * - `SURPRISEBOT_STATE_DIR/credentials` (canonical server/default)
 * - `~/.surprisebot/credentials` (legacy default)
 */
export function resolveOAuthDir(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  const override = env.SURPRISEBOT_OAUTH_DIR?.trim();
  if (override) return resolveUserPath(override);
  return path.join(stateDir, "credentials");
}

export function resolveOAuthPath(
  env: NodeJS.ProcessEnv = process.env,
  stateDir: string = resolveStateDir(env, os.homedir),
): string {
  return path.join(resolveOAuthDir(env, stateDir), OAUTH_FILENAME);
}

export function resolveGatewayPort(
  cfg?: SurprisebotConfig,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const envRaw = env.SURPRISEBOT_GATEWAY_PORT?.trim();
  if (envRaw) {
    const parsed = Number.parseInt(envRaw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const configPort = cfg?.gateway?.port;
  if (typeof configPort === "number" && Number.isFinite(configPort)) {
    if (configPort > 0) return configPort;
  }
  return DEFAULT_GATEWAY_PORT;
}
