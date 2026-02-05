import { describe, expect, it } from "vitest";

import { buildMentionRegexes, matchesMentionPatterns, normalizeMentionText } from "./mentions.js";

describe("mention helpers", () => {
  it("builds regexes and skips invalid patterns", () => {
    const regexes = buildMentionRegexes({
      messages: {
        groupChat: { mentionPatterns: ["\\bsurprisebot\\b", "(invalid"] },
      },
    });
    expect(regexes).toHaveLength(1);
    expect(regexes[0]?.test("surprisebot")).toBe(true);
  });

  it("normalizes zero-width characters", () => {
    expect(normalizeMentionText("cl\u200bawd")).toBe("surprisebot");
  });

  it("matches patterns case-insensitively", () => {
    const regexes = buildMentionRegexes({
      messages: { groupChat: { mentionPatterns: ["\\bsurprisebot\\b"] } },
    });
    expect(matchesMentionPatterns("SURPRISEBOT: hi", regexes)).toBe(true);
  });

  it("uses per-agent mention patterns when configured", () => {
    const regexes = buildMentionRegexes(
      {
        messages: {
          groupChat: { mentionPatterns: ["\\bglobal\\b"] },
        },
        agents: {
          list: [
            {
              id: "work",
              groupChat: { mentionPatterns: ["\\bworkbot\\b"] },
            },
          ],
        },
      },
      "work",
    );
    expect(matchesMentionPatterns("workbot: hi", regexes)).toBe(true);
    expect(matchesMentionPatterns("global: hi", regexes)).toBe(false);
  });
});
