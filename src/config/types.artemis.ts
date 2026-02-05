export type ArtemisPromptFeedbackConfig = {
  enabled?: boolean;
  minPrecision?: number;
  minSamples?: number;
  action?: "disable_prompt_generation" | "prefer_prompt_generation";
};

export type ArtemisStanfordConfig = {
  enabled?: boolean;
  intervalMinutes?: number;
  configPath?: string;
  artemisDir?: string;
  outputDir?: string;
  pythonBin?: string;
  durationMinutes?: number;
  supervisorModel?: string;
  sessionRoot?: string;
  codexBinary?: string;
  benchmarkMode?: boolean;
  skipTodos?: boolean;
  usePromptGeneration?: boolean;
  promptFeedback?: ArtemisPromptFeedbackConfig;
  finishOnSubmit?: boolean;
  jobType?: string;
  env?: Record<string, string>;
  syncArtifacts?: boolean;
};

export type ArtemisCertConfig = {
  enabled?: boolean;
  intervalMinutes?: number;
  inputPath?: string;
  outputDir?: string;
  outputFile?: string;
  source?: string;
  jobType?: string;
  command?: string;
  args?: string[];
  workingDir?: string;
  timeoutMinutes?: number;
  env?: Record<string, string>;
};

export type ArtemisConfig = {
  enabled?: boolean;
  stanford?: ArtemisStanfordConfig;
  cert?: ArtemisCertConfig;
};
