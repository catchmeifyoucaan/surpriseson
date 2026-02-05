import { z } from "zod";

const BudgetWindowSchema = z
  .object({
    window: z.string().optional(),
    tokenLimit: z.number().int().nonnegative().optional(),
    runLimit: z.number().int().nonnegative().optional(),
    concurrencyLimit: z.number().int().nonnegative().optional(),
    tokenEstimate: z.number().int().nonnegative().optional(),
    queryLimit: z.number().int().nonnegative().optional(),
    maxRuntimeSeconds: z.number().int().nonnegative().optional(),
    maxOutputChars: z.number().int().nonnegative().optional(),
  })
  .partial();

export const BudgetsSchema = z
  .object({
    global: BudgetWindowSchema.optional(),
    byAgent: z.record(z.string(), BudgetWindowSchema).optional(),
    byJobType: z.record(z.string(), BudgetWindowSchema).optional(),
    alerts: z
      .object({
        cooldownMs: z.number().int().nonnegative().optional(),
        maxPerWindow: z.number().int().nonnegative().optional(),
      })
      .optional(),
    enforcement: z
      .object({
        mode: z.union([z.literal("soft"), z.literal("hard")]).optional(),
        deferMinutes: z.number().int().nonnegative().optional(),
        warnThresholdPct: z.number().int().min(0).max(100).optional(),
        hardStopThresholdPct: z.number().int().min(0).max(100).optional(),
      })
      .optional(),
  })
  .optional();
