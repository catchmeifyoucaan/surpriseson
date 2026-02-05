import { describe, expect, it } from "vitest";
import { resolveChannelCapabilities } from "./channel-capabilities.js";
import type { SurprisebotConfig } from "./config.js";

describe("resolveChannelCapabilities", () => {
  it("returns undefined for missing inputs", () => {
    expect(resolveChannelCapabilities({})).toBeUndefined();
    expect(resolveChannelCapabilities({ cfg: {} as SurprisebotConfig })).toBeUndefined();
    expect(resolveChannelCapabilities({ cfg: {} as SurprisebotConfig, channel: "" })).toBeUndefined();
  });

  it("normalizes and prefers per-account capabilities", () => {
    const cfg = {
      channels: {
        telegram: {
          capabilities: [" inlineButtons ", ""],
          accounts: {
            default: {
              capabilities: [" perAccount ", "  "],
            },
          },
        },
      },
    } satisfies Partial<SurprisebotConfig>;

    expect(
      resolveChannelCapabilities({
        cfg: cfg as SurprisebotConfig,
        channel: "telegram",
        accountId: "default",
      }),
    ).toEqual(["perAccount"]);
  });

  it("falls back to provider capabilities when account capabilities are missing", () => {
    const cfg = {
      channels: {
        telegram: {
          capabilities: ["inlineButtons"],
          accounts: {
            default: {},
          },
        },
      },
    } satisfies Partial<SurprisebotConfig>;

    expect(
      resolveChannelCapabilities({
        cfg: cfg as SurprisebotConfig,
        channel: "telegram",
        accountId: "default",
      }),
    ).toEqual(["inlineButtons"]);
  });

  it("matches account keys case-insensitively", () => {
    const cfg = {
      channels: {
        slack: {
          accounts: {
            Family: { capabilities: ["threads"] },
          },
        },
      },
    } satisfies Partial<SurprisebotConfig>;

    expect(
      resolveChannelCapabilities({
        cfg: cfg as SurprisebotConfig,
        channel: "slack",
        accountId: "family",
      }),
    ).toEqual(["threads"]);
  });

  it("supports msteams capabilities", () => {
    const cfg = {
      channels: { msteams: { capabilities: [" polls ", ""] } },
    } satisfies Partial<SurprisebotConfig>;

    expect(
      resolveChannelCapabilities({
        cfg: cfg as SurprisebotConfig,
        channel: "msteams",
      }),
    ).toEqual(["polls"]);
  });
});
