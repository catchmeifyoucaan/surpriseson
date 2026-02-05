import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { applyMemoryAction } from "./commands-memory.js";

describe("memory commands", () => {
  it("records preferences and updates profile", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "surprisebot-mem-"));
    await applyMemoryAction({
      workspaceDir: dir,
      action: "prefer",
      target: "preference",
      text: "Use pnpm for installs.",
    });
    const preferences = await fs.readFile(path.join(dir, "memory", "preferences.md"), "utf8");
    const profile = await fs.readFile(path.join(dir, "memory", "profile.md"), "utf8");
    expect(preferences).toContain("Use pnpm for installs.");
    expect(preferences).toMatch(/PREF-\d{8}-\d+/);
    expect(profile).toContain("Use pnpm for installs.");
  });

  it("records and deprecates decisions by id", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "surprisebot-mem-"));
    await applyMemoryAction({
      workspaceDir: dir,
      action: "decide",
      target: "decision",
      text: "Standardize on single deployment pipeline.",
    });
    const decisionsPath = path.join(dir, "memory", "decisions.md");
    const before = await fs.readFile(decisionsPath, "utf8");
    const idMatch = before.match(/DEC-\d{8}-\d+/);
    expect(idMatch).not.toBeNull();
    const decisionId = idMatch?.[0];
    if (!decisionId) throw new Error("Decision id missing");

    await applyMemoryAction({
      workspaceDir: dir,
      action: "deprecate",
      target: "decision",
      text: decisionId,
    });

    const after = await fs.readFile(decisionsPath, "utf8");
    expect(after).toContain(decisionId);
    expect(after).toContain("DEPRECATED");
  });

  it("tracks preference drift by deprecating older entries", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "surprisebot-mem-"));
    await applyMemoryAction({
      workspaceDir: dir,
      action: "prefer",
      target: "preference",
      text: "Use pnpm for installs.",
    });
    await applyMemoryAction({
      workspaceDir: dir,
      action: "prefer",
      target: "preference",
      text: "Use pnpm for installs by default.",
    });
    const preferences = await fs.readFile(path.join(dir, "memory", "preferences.md"), "utf8");
    expect(preferences).toContain("DEPRECATED");
    expect(preferences).toContain("superseded by");
  });
});
