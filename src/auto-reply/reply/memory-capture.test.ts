import { describe, expect, it } from "vitest";
import type { SurprisebotConfig } from "../../config/config.js";
import {
  DEFAULT_MEMORY_CAPTURE_MIN_INTERVAL_MINUTES,
  DEFAULT_MEMORY_CAPTURE_MIN_NEW_TOKENS,
  DEFAULT_MEMORY_CAPTURE_PROMPT,
  DEFAULT_MEMORY_CAPTURE_SYSTEM_PROMPT,
  resolveMemoryCaptureSettings,
  shouldRunMemoryCapture,
} from "./memory-capture.js";

describe("memory capture", () => {
  it("returns null when disabled", () => {
    const cfg = { agents: { defaults: { memoryCapture: { enabled: false } } } } as SurprisebotConfig;
    expect(resolveMemoryCaptureSettings({ cfg, agentId: "main" })).toBeNull();
  });

  it("uses defaults when enabled without overrides", () => {
    const cfg = { agents: { defaults: { memoryCapture: { enabled: true } } } } as SurprisebotConfig;
    const settings = resolveMemoryCaptureSettings({ cfg, agentId: "main" });
    expect(settings).not.toBeNull();
    expect(settings?.minIntervalMinutes).toBe(DEFAULT_MEMORY_CAPTURE_MIN_INTERVAL_MINUTES);
    expect(settings?.minNewTokens).toBe(DEFAULT_MEMORY_CAPTURE_MIN_NEW_TOKENS);
    expect(settings?.prompt).toContain(DEFAULT_MEMORY_CAPTURE_PROMPT);
    expect(settings?.systemPrompt).toContain(DEFAULT_MEMORY_CAPTURE_SYSTEM_PROMPT);
  });

  it("respects interval and token thresholds", () => {
    const now = Date.now();
    const entry = {
      totalTokens: 5000,
      memoryCaptureAt: now - 5 * 60_000,
      memoryCaptureTokenCount: 4600,
    };
    expect(
      shouldRunMemoryCapture({
        entry,
        now,
        minIntervalMinutes: 10,
        minNewTokens: 600,
      }),
    ).toBe(false);

    expect(
      shouldRunMemoryCapture({
        entry: { ...entry, memoryCaptureAt: now - 20 * 60_000, memoryCaptureTokenCount: 4000 },
        now,
        minIntervalMinutes: 10,
        minNewTokens: 600,
      }),
    ).toBe(true);
  });
});
