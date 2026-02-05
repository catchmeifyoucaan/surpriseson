export type BudgetWindowConfig = {
  /** Rolling window duration (e.g. 24h, 6h). */
  window?: string;
  /** Token budget for the window. */
  tokenLimit?: number;
  /** Run budget for the window. */
  runLimit?: number;
  /** Concurrent run budget. */
  concurrencyLimit?: number;
  /** Optional estimated tokens per run when not provided by the caller. */
  tokenEstimate?: number;
  /** Optional query budget per run (web_search calls). */
  queryLimit?: number;
  /** Optional max runtime per run in seconds. */
  maxRuntimeSeconds?: number;
  /** Optional max output characters per run. */
  maxOutputChars?: number;
};

export type BudgetsConfig = {
  /** Global budget applied to all runs. */
  global?: BudgetWindowConfig;
  /** Budget per agent (keyed by agent id). */
  byAgent?: Record<string, BudgetWindowConfig>;
  /** Budget per job type (keyed by jobType). */
  byJobType?: Record<string, BudgetWindowConfig>;
  /** Alert throttling for budget events. */
  alerts?: {
    cooldownMs?: number;
    maxPerWindow?: number;
  };
  /** Enforcement behavior for overages. */
  enforcement?: {
    mode?: "soft" | "hard";
    deferMinutes?: number;
    warnThresholdPct?: number;
    hardStopThresholdPct?: number;
  };
};
