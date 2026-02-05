import crypto from "node:crypto";

import type { BudgetsConfig, BudgetWindowConfig } from "../config/types.budgets.js";
import type { SurprisebotConfig } from "../config/config.js";
import { parseDurationMs } from "../cli/parse-duration.js";
import { createSubsystemLogger } from "../logging.js";
import {
  appendMissionControlRecord,
  readMissionControlRecords,
  type BudgetLedgerRecord,
  type RunLedgerRecord,
} from "./mission-control/ledger.js";

const log = createSubsystemLogger("gateway/budgets");

export type BudgetDecision = "allow" | "deny" | "defer" | "throttle";

export type BudgetCheck = {
  scope: "global" | "agent" | "job" | "run";
  scopeId?: string | null;
  decision: BudgetDecision;
  reason: string;
  snapshot: Record<string, unknown>;
};

export type BudgetEvaluation = {
  decision: BudgetDecision;
  reason: string;
  checks: BudgetCheck[];
  snapshot: Record<string, unknown>;
};

const DEFAULT_WINDOW = "24h";
const DEFAULT_WARN_PCT = 85;
const DEFAULT_HARD_PCT = 100;

function resolveBudgets(cfg: SurprisebotConfig): BudgetsConfig | undefined {
  return cfg.budgets ?? undefined;
}

function resolveWindowMs(windowRaw?: string): number {
  const window = windowRaw?.trim() || DEFAULT_WINDOW;
  try {
    return parseDurationMs(window, { defaultUnit: "h" });
  } catch {
    return parseDurationMs(DEFAULT_WINDOW, { defaultUnit: "h" });
  }
}

function normalizeBudgetWindow(window?: BudgetWindowConfig, fallback?: BudgetWindowConfig): BudgetWindowConfig {
  return {
    window: window?.window ?? fallback?.window,
    tokenLimit: window?.tokenLimit ?? fallback?.tokenLimit,
    runLimit: window?.runLimit ?? fallback?.runLimit,
    concurrencyLimit: window?.concurrencyLimit ?? fallback?.concurrencyLimit,
    tokenEstimate: window?.tokenEstimate ?? fallback?.tokenEstimate,
    queryLimit: window?.queryLimit ?? fallback?.queryLimit,
    maxRuntimeSeconds: window?.maxRuntimeSeconds ?? fallback?.maxRuntimeSeconds,
    maxOutputChars: window?.maxOutputChars ?? fallback?.maxOutputChars,
  };
}
export function resolveBudgetCaps(params: {
  cfg: SurprisebotConfig;
  agentId: string;
  jobType?: string | null;
}): {
  queryLimit?: number;
  maxRuntimeSeconds?: number;
  maxOutputChars?: number;
} {
  const budgets = resolveBudgets(params.cfg);
  if (!budgets) return {};
  const globalWindow = normalizeBudgetWindow(budgets.global);
  const jobWindow = normalizeBudgetWindow(
    params.jobType ? budgets.byJobType?.[params.jobType] : undefined,
    budgets.global,
  );
  const agentWindow = normalizeBudgetWindow(budgets.byAgent?.[params.agentId], budgets.global);
  return {
    queryLimit: jobWindow.queryLimit ?? agentWindow.queryLimit ?? globalWindow.queryLimit,
    maxRuntimeSeconds:
      jobWindow.maxRuntimeSeconds ?? agentWindow.maxRuntimeSeconds ?? globalWindow.maxRuntimeSeconds,
    maxOutputChars:
      jobWindow.maxOutputChars ?? agentWindow.maxOutputChars ?? globalWindow.maxOutputChars,
  };
}



async function loadRecentRuns(params: {
  cfg: SurprisebotConfig;
  sinceMs: number;
}): Promise<RunLedgerRecord[]> {
  const records = await readMissionControlRecords<RunLedgerRecord>({
    cfg: params.cfg,
    kind: "run-ledger",
    sinceMs: params.sinceMs,
  });
  return records.filter((record) => record && typeof record === "object");
}

function countUsage(params: {
  runs: RunLedgerRecord[];
  nowMs: number;
  windowMs: number;
}) {
  let usedTokens = 0;
  let usedRuns = 0;
  let running = 0;
  const latest = new Map<string, RunLedgerRecord>();
  for (const run of params.runs) {
    if (!run || typeof run !== "object") continue;
    const id = run.id ?? "";
    if (!id) continue;
    const tsMs = Date.parse(run.ts ?? "");
    const existing = latest.get(id);
    if (!existing) {
      latest.set(id, run);
      continue;
    }
    const existingTs = Date.parse(existing.ts ?? "");
    if (Number.isFinite(tsMs) && (!Number.isFinite(existingTs) || tsMs > existingTs)) {
      latest.set(id, run);
    }
  }
  for (const run of latest.values()) {
    const tsMs = Date.parse(run.startedAt ?? run.ts ?? "");
    if (!Number.isFinite(tsMs)) continue;
    if (tsMs < params.nowMs - params.windowMs) continue;
    usedRuns += 1;
    const tokens = typeof run.estimatedTokens === "number" ? run.estimatedTokens : 0;
    usedTokens += tokens;
    if (run.status === "running") running += 1;
  }
  return { usedTokens, usedRuns, running };
}

function evaluateWindow(params: {
  scope: "global" | "agent" | "job" | "run";
  scopeId?: string | null;
  window: BudgetWindowConfig;
  usage: { usedTokens: number; usedRuns: number; running: number };
  estimatedTokens: number;
  enforcement: { mode: "soft" | "hard"; warnPct: number; hardPct: number };
}): BudgetCheck {
  const { usage, estimatedTokens } = params;
  const runLimit = params.window.runLimit;
  const tokenLimit = params.window.tokenLimit;
  const concurrencyLimit = params.window.concurrencyLimit;
  const projectedRuns = usage.usedRuns + 1;
  const projectedTokens = usage.usedTokens + estimatedTokens;

  if (typeof concurrencyLimit === "number" && concurrencyLimit >= 0) {
    if (usage.running >= concurrencyLimit) {
      const decision: BudgetDecision = params.enforcement.mode === "hard" ? "deny" : "defer";
      return {
        scope: params.scope,
        scopeId: params.scopeId ?? null,
        decision,
        reason: "concurrency_limit_reached",
        snapshot: {
          running: usage.running,
          concurrencyLimit,
        },
      };
    }
  }

  if (typeof runLimit === "number" && runLimit >= 0) {
    const pct = runLimit === 0 ? 100 : (projectedRuns / runLimit) * 100;
    if (pct >= params.enforcement.hardPct) {
      return {
        scope: params.scope,
        scopeId: params.scopeId ?? null,
        decision: params.enforcement.mode === "hard" ? "deny" : "defer",
        reason: "run_limit_reached",
        snapshot: { projectedRuns, runLimit, pct },
      };
    }
    if (pct >= params.enforcement.warnPct) {
      return {
        scope: params.scope,
        scopeId: params.scopeId ?? null,
        decision: "throttle",
        reason: "run_limit_warning",
        snapshot: { projectedRuns, runLimit, pct },
      };
    }
  }

  if (typeof tokenLimit === "number" && tokenLimit >= 0) {
    const pct = tokenLimit === 0 ? 100 : (projectedTokens / tokenLimit) * 100;
    if (pct >= params.enforcement.hardPct) {
      return {
        scope: params.scope,
        scopeId: params.scopeId ?? null,
        decision: params.enforcement.mode === "hard" ? "deny" : "defer",
        reason: "token_limit_reached",
        snapshot: { projectedTokens, tokenLimit, pct },
      };
    }
    if (pct >= params.enforcement.warnPct) {
      return {
        scope: params.scope,
        scopeId: params.scopeId ?? null,
        decision: "throttle",
        reason: "token_limit_warning",
        snapshot: { projectedTokens, tokenLimit, pct },
      };
    }
  }

  return {
    scope: params.scope,
    scopeId: params.scopeId ?? null,
    decision: "allow",
    reason: "within_limits",
    snapshot: {
      projectedRuns,
      runLimit,
      projectedTokens,
      tokenLimit,
      running: usage.running,
      concurrencyLimit,
    },
  };
}

function collapseDecision(checks: BudgetCheck[]): BudgetDecision {
  if (checks.some((c) => c.decision === "deny")) return "deny";
  if (checks.some((c) => c.decision === "defer")) return "defer";
  if (checks.some((c) => c.decision === "throttle")) return "throttle";
  return "allow";
}

export async function evaluateBudget(params: {
  cfg: SurprisebotConfig;
  agentId: string;
  jobType?: string | null;
  estimatedTokens?: number | null;
  incidentId?: string | null;
  runId?: string | null;
}): Promise<BudgetEvaluation> {
  const budgets = resolveBudgets(params.cfg);
  if (!budgets) {
    return { decision: "allow", reason: "no_budgets_configured", checks: [], snapshot: {} };
  }

  const enforcement = {
    mode: budgets.enforcement?.mode ?? "soft",
    warnPct: budgets.enforcement?.warnThresholdPct ?? DEFAULT_WARN_PCT,
    hardPct: budgets.enforcement?.hardStopThresholdPct ?? DEFAULT_HARD_PCT,
  };

  const nowMs = Date.now();
  const globalWindow = normalizeBudgetWindow(budgets.global);
  const jobWindow = normalizeBudgetWindow(
    params.jobType ? budgets.byJobType?.[params.jobType] : undefined,
    budgets.global,
  );
  const agentWindow = normalizeBudgetWindow(budgets.byAgent?.[params.agentId], budgets.global);

  const windowMs = resolveWindowMs(globalWindow.window);
  const runs = await loadRecentRuns({ cfg: params.cfg, sinceMs: nowMs - windowMs });
  const usage = countUsage({ runs, nowMs, windowMs });

  const estimatedTokens =
    typeof params.estimatedTokens === "number"
      ? params.estimatedTokens
      : params.jobType && budgets.byJobType?.[params.jobType]?.tokenEstimate
        ? budgets.byJobType?.[params.jobType]?.tokenEstimate ?? 0
        : budgets.byAgent?.[params.agentId]?.tokenEstimate ?? budgets.global?.tokenEstimate ?? 0;

  const checks: BudgetCheck[] = [];
  if (globalWindow && (globalWindow.runLimit || globalWindow.tokenLimit || globalWindow.concurrencyLimit)) {
    checks.push(
      evaluateWindow({
        scope: "global",
        window: globalWindow,
        usage,
        estimatedTokens,
        enforcement,
      }),
    );
  }
  if (params.jobType && jobWindow && (jobWindow.runLimit || jobWindow.tokenLimit || jobWindow.concurrencyLimit)) {
    checks.push(
      evaluateWindow({
        scope: "job",
        scopeId: params.jobType,
        window: jobWindow,
        usage,
        estimatedTokens,
        enforcement,
      }),
    );
  }
  if (agentWindow && (agentWindow.runLimit || agentWindow.tokenLimit || agentWindow.concurrencyLimit)) {
    checks.push(
      evaluateWindow({
        scope: "agent",
        scopeId: params.agentId,
        window: agentWindow,
        usage,
        estimatedTokens,
        enforcement,
      }),
    );
  }

  const decision = collapseDecision(checks);
  const reason = checks.find((check) => check.decision !== "allow")?.reason ?? "within_limits";
  const snapshot = {
    usage,
    estimatedTokens,
    jobType: params.jobType ?? null,
    agentId: params.agentId,
    enforcement,
  };

  try {
    const record: BudgetLedgerRecord = {
      id: `budget-${crypto.randomUUID()}`,
      ts: new Date().toISOString(),
      source: "system",
      version: 1,
      scope: checks[0]?.scope ?? "run",
      scopeId: checks[0]?.scopeId ?? null,
      decision,
      reason,
      budgetSnapshot: snapshot,
      meta: {
        incidentId: params.incidentId ?? undefined,
        runId: params.runId ?? undefined,
        checks,
      },
    };
    await appendMissionControlRecord({ cfg: params.cfg, kind: "budget-ledger", record });
  } catch (err) {
    log.warn(`budget ledger write failed: ${String(err)}`);
  }

  return { decision, reason, checks, snapshot };
}
