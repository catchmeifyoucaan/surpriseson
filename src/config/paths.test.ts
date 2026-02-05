import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveOAuthDir, resolveOAuthPath } from "./paths.js";

describe("oauth paths", () => {
  it("prefers SURPRISEBOT_OAUTH_DIR over SURPRISEBOT_STATE_DIR", () => {
    const env = {
      SURPRISEBOT_OAUTH_DIR: "/custom/oauth",
      SURPRISEBOT_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from SURPRISEBOT_STATE_DIR when unset", () => {
    const env = {
      SURPRISEBOT_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});
