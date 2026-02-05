import type { ResolvedMemorySearchConfig } from "../agents/memory-search.js";
import type { SurprisebotConfig } from "../config/config.js";
import { MemoryIndexManager } from "./manager.js";

export type MemorySearchManagerResult = {
  manager: MemoryIndexManager | null;
  error?: string;
};

export async function getMemorySearchManager(params: {
  cfg: SurprisebotConfig;
  agentId: string;
  syncOverrides?: Partial<ResolvedMemorySearchConfig["sync"]>;
}): Promise<MemorySearchManagerResult> {
  try {
    const manager = await MemoryIndexManager.get(params);
    return { manager };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { manager: null, error: message };
  }
}
