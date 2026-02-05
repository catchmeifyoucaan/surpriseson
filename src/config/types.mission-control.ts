export type MissionControlTrustTier = "trusted" | "unverified" | "quarantine";

export type MissionControlTrustConfig = {
  /** Default trust tier for new signals/tasks. */
  defaultTier?: MissionControlTrustTier;
  /** Override trust tier by incident/source type (e.g., "recon", "research", "exposure"). */
  bySource?: Record<string, MissionControlTrustTier>;
  /** Explicit list of sources that should be quarantined. */
  quarantineSources?: string[];
};

export type MissionControlAlertConfig = {
  /** Only deliver high-signal alerts to critical channels. */
  highSignalOnly?: boolean;
  /** Minimum signal score (0-100) required to alert. */
  minSignalScore?: number;
  /** Require evidence/URL count before alerting. */
  minEvidenceCount?: number;
  /** Suppress alert if no evidence is detected. */
  suppressIfMissingEvidence?: boolean;
};

export type MissionControlIncidentConfig = {
  /** Minimum severity that creates tasks (default: medium). */
  minSeverity?: "low" | "medium" | "high";
  /** Default task priority for incident-created tasks. */
  defaultPriority?: "low" | "medium" | "high" | "critical";
};

export type MissionControlQAConfig = {
  /** Agent id to assign verification tasks. */
  agentId?: string;
  /** Trust tiers requiring QA before escalation. */
  requiredTrustTiers?: MissionControlTrustTier[];
  /** Incident severities requiring QA. */
  requiredSeverities?: Array<"low" | "medium" | "high">;
};

export type MissionControlReconConfig = {
  /** Agent id for recon follow-up tasks. */
  agentId?: string;
};

export type MissionControlRollupConfig = {
  /** Enable daily rollups for mission control ledgers. */
  enabled?: boolean;
  /** Days of ledger entries to keep in primary files (older entries roll to rollups). */
  keepDays?: number;
  /** Minimum ledger file size in bytes before rollup triggers. */
  minBytes?: number;
  /** How often to check rollup (minutes). */
  intervalMinutes?: number;
};


export type MissionControlMaintenanceConfig = {
  /** Enable mission control maintenance jobs (dedupe/prune). */
  enabled?: boolean;
  /** How often to run maintenance (minutes). */
  intervalMinutes?: number;
};

export type MissionControlMirrorConfig = {
  enabled?: boolean;
  file?: {
    path?: string;
  };
  webhook?: {
    url?: string;
    headers?: Record<string, string>;
    timeoutSeconds?: number;
  };
};

export type MissionControlConfig = {
  /** Optional override for mission control DB path. */
  dbPath?: string;
  /** Emergency stop for mission control automation (incident -> task, alerts). */
  killSwitch?: boolean;
  /** Optional override for mission control ledger dir. */
  ledgerDir?: string;
  /** Trust tier mapping for incident/task creation. */
  trust?: MissionControlTrustConfig;
  /** Alert gating config (high-signal only). */
  alerts?: MissionControlAlertConfig;
  /** Incident-to-task creation settings. */
  incidents?: MissionControlIncidentConfig;
  /** QA verification requirements. */
  qa?: MissionControlQAConfig;
  /** Recon follow-up settings. */
  recon?: MissionControlReconConfig;
  /** Mirror local ledger/db to external sinks. */
  mirror?: MissionControlMirrorConfig;
  /** Rollup/compaction settings for mission control ledgers. */
  rollup?: MissionControlRollupConfig;
  /** Maintenance settings for dedupe/prune jobs. */
  maintenance?: MissionControlMaintenanceConfig;
};
