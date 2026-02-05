import { z } from "zod";

const TrustTier = z.enum(["trusted", "unverified", "quarantine"]);

export const MissionControlMaintenanceSchema = z
  .object({
    enabled: z.boolean().optional(),
    intervalMinutes: z.number().optional(),
  })
  .optional();

export const MissionControlSchema = z
  .object({
    dbPath: z.string().optional(),
    ledgerDir: z.string().optional(),
    killSwitch: z.boolean().optional(),
    trust: z
      .object({
        defaultTier: TrustTier.optional(),
        bySource: z.record(z.string(), TrustTier).optional(),
        quarantineSources: z.array(z.string()).optional(),
      })
      .optional(),
    alerts: z
      .object({
        highSignalOnly: z.boolean().optional(),
        minSignalScore: z.number().optional(),
        minEvidenceCount: z.number().optional(),
        suppressIfMissingEvidence: z.boolean().optional(),
      })
      .optional(),
    incidents: z
      .object({
        minSeverity: z.enum(["low", "medium", "high"]).optional(),
        defaultPriority: z.enum(["low", "medium", "high", "critical"]).optional(),
      })
      .optional(),
    qa: z
      .object({
        agentId: z.string().optional(),
        requiredTrustTiers: z.array(TrustTier).optional(),
        requiredSeverities: z.array(z.enum(["low", "medium", "high"])).optional(),
      })
      .optional(),
    recon: z
      .object({
        agentId: z.string().optional(),
      })
      .optional(),
    mirror: z
      .object({
        enabled: z.boolean().optional(),
        file: z
          .object({
            path: z.string().optional(),
          })
          .optional(),
        webhook: z
          .object({
            url: z.string().optional(),
            headers: z.record(z.string(), z.string()).optional(),
            timeoutSeconds: z.number().optional(),
          })
          .optional(),
      })
      .optional(),
    rollup: z
      .object({
        enabled: z.boolean().optional(),
        keepDays: z.number().optional(),
        minBytes: z.number().optional(),
        intervalMinutes: z.number().optional(),
      })
      .optional(),
    maintenance: MissionControlMaintenanceSchema,
  })
  .default({});
