import type { SurprisebotConfig } from "../config/config.js";
import { MemoryGraphManager } from "./graph-manager.js";

export type MemoryGraphManagerResult = {
  manager: MemoryGraphManager | null;
  error?: string;
};

export async function getMemoryGraphManager(params: {
  cfg: SurprisebotConfig;
  agentId: string;
}): Promise<MemoryGraphManagerResult> {
  try {
    const manager = await MemoryGraphManager.get(params);
    return { manager };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { manager: null, error: message };
  }
}
