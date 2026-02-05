import { z } from "zod";

const EnvMapSchema = z.record(z.string(), z.string()).optional();

const PromptFeedbackSchema = z
  .object({
    enabled: z.boolean().optional(),
    minPrecision: z.number().optional(),
    minSamples: z.number().optional(),
    action: z.enum(["disable_prompt_generation", "prefer_prompt_generation"]).optional(),
  })
  .optional();

const ArtemisStanfordSchema = z
  .object({
    enabled: z.boolean().optional(),
    intervalMinutes: z.number().optional(),
    configPath: z.string().optional(),
    artemisDir: z.string().optional(),
    outputDir: z.string().optional(),
    pythonBin: z.string().optional(),
    durationMinutes: z.number().optional(),
    supervisorModel: z.string().optional(),
    sessionRoot: z.string().optional(),
    codexBinary: z.string().optional(),
    benchmarkMode: z.boolean().optional(),
    skipTodos: z.boolean().optional(),
    usePromptGeneration: z.boolean().optional(),
    promptFeedback: PromptFeedbackSchema,
    finishOnSubmit: z.boolean().optional(),
    jobType: z.string().optional(),
    env: EnvMapSchema,
    syncArtifacts: z.boolean().optional(),
  })
  .optional();

const ArtemisCertSchema = z
  .object({
    enabled: z.boolean().optional(),
    intervalMinutes: z.number().optional(),
    inputPath: z.string().optional(),
    outputDir: z.string().optional(),
    outputFile: z.string().optional(),
    source: z.string().optional(),
    jobType: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    workingDir: z.string().optional(),
    timeoutMinutes: z.number().optional(),
    env: EnvMapSchema,
  })
  .optional();

export const ArtemisSchema = z
  .object({
    enabled: z.boolean().optional(),
    stanford: ArtemisStanfordSchema,
    cert: ArtemisCertSchema,
  })
  .optional();
