import type { GatewayBrowserClient } from "../gateway";
import type {
  MissionControlSnapshot,
  MissionControlTaskRecord,
} from "../types";

const FILTER_KEY = "surprisebot.control.mission-control.filters.v1";

export type MissionControlPaging = {
  tasks: { limit: number; offset: number };
  activities: { limit: number; offset: number };
  ledger: { limit: number };
  incidents: { limit: number };
};

export type MissionControlFilters = {
  query: string;
  status: string;
  severity: string;
  trustTier: string;
};

export type MissionControlState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  missionControlLoading: boolean;
  missionControlError: string | null;
  missionControlSnapshot: MissionControlSnapshot | null;
  missionControlSelectedTaskId: string | null;
  missionControlFilters: MissionControlFilters;
  missionControlPaging: MissionControlPaging;
  missionControlDenseMode: boolean;
  missionControlQuickOpen: boolean;
};

export function loadMissionControlFilters(): MissionControlFilters {
  const defaults: MissionControlFilters = {
    query: "",
    status: "",
    severity: "",
    trustTier: "",
  };
  try {
    const raw = localStorage.getItem(FILTER_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<MissionControlFilters>;
    return {
      query: typeof parsed.query === "string" ? parsed.query : defaults.query,
      status: typeof parsed.status === "string" ? parsed.status : defaults.status,
      severity: typeof parsed.severity === "string" ? parsed.severity : defaults.severity,
      trustTier: typeof parsed.trustTier === "string" ? parsed.trustTier : defaults.trustTier,
    };
  } catch {
    return defaults;
  }
}

export function saveMissionControlFilters(filters: MissionControlFilters) {
  localStorage.setItem(FILTER_KEY, JSON.stringify(filters));
}

export function resolveSelectedTask(snapshot: MissionControlSnapshot | null, taskId: string | null): MissionControlTaskRecord | null {
  if (!snapshot || !taskId) return null;
  return snapshot.tasks.find((task) => task.id === taskId) ?? null;
}

export async function loadMissionControl(state: MissionControlState, opts?: { paging?: MissionControlPaging }) {
  if (!state.client || !state.connected) return;
  if (state.missionControlLoading) return;
  state.missionControlLoading = true;
  state.missionControlError = null;
  try {
    const paging = opts?.paging ?? state.missionControlPaging;
    const res = (await state.client.request("mission-control.snapshot", {
      tasks: paging.tasks,
      activities: paging.activities,
      ledger: paging.ledger,
      incidents: paging.incidents,
    })) as MissionControlSnapshot;
    state.missionControlSnapshot = res;
    if (state.missionControlSelectedTaskId) {
      const exists = res.tasks.some((task) => task.id === state.missionControlSelectedTaskId);
      if (!exists) state.missionControlSelectedTaskId = null;
    }
  } catch (err) {
    state.missionControlError = String(err);
  } finally {
    state.missionControlLoading = false;
  }
}

export async function updateMissionControlTask(
  state: MissionControlState,
  taskId: string,
  patch: Record<string, unknown>,
) {
  if (!state.client || !state.connected) return;
  try {
    await state.client.request("mission-control.task.update", { id: taskId, patch });
    await loadMissionControl(state);
  } catch (err) {
    state.missionControlError = String(err);
  }
}

export async function qaMissionControlTask(
  state: MissionControlState,
  taskId: string,
  action: "approve" | "deny",
) {
  if (!state.client || !state.connected) return;
  try {
    await state.client.request("mission-control.task.qa", { id: taskId, action });
    await loadMissionControl(state);
  } catch (err) {
    state.missionControlError = String(err);
  }
}

export async function requeueMissionControlTask(state: MissionControlState, taskId: string) {
  if (!state.client || !state.connected) return;
  try {
    await state.client.request("mission-control.task.requeue", { id: taskId });
    await loadMissionControl(state);
  } catch (err) {
    state.missionControlError = String(err);
  }
}

async function patchConfig(state: MissionControlState, patch: Record<string, unknown>) {
  if (!state.client || !state.connected) return;
  const snapshot = (await state.client.request("config.get", {})) as { hash?: string | null };
  const baseHash = snapshot?.hash ?? null;
  if (!baseHash) {
    throw new Error("Config base hash unavailable; reload config and retry.");
  }
  await state.client.request("config.patch", { baseHash, patch });
}

export async function toggleMissionControlKillSwitch(state: MissionControlState, enabled: boolean) {
  await patchConfig(state, { missionControl: { killSwitch: enabled } });
  await loadMissionControl(state);
}

export async function setBudgetEnforcementMode(state: MissionControlState, mode: "soft" | "hard") {
  await patchConfig(state, { budgets: { enforcement: { mode } } });
  await loadMissionControl(state);
}
