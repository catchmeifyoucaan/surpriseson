import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withEnvOverride, withTempHome } from "./test-helpers.js";

describe("Nix integration (U3, U5, U9)", () => {
  describe("U3: isNixMode env var detection", () => {
    it("isNixMode is false when SURPRISEBOT_NIX_MODE is not set", async () => {
      await withEnvOverride({ SURPRISEBOT_NIX_MODE: undefined }, async () => {
        const { isNixMode } = await import("./config.js");
        expect(isNixMode).toBe(false);
      });
    });

    it("isNixMode is false when SURPRISEBOT_NIX_MODE is empty", async () => {
      await withEnvOverride({ SURPRISEBOT_NIX_MODE: "" }, async () => {
        const { isNixMode } = await import("./config.js");
        expect(isNixMode).toBe(false);
      });
    });

    it("isNixMode is false when SURPRISEBOT_NIX_MODE is not '1'", async () => {
      await withEnvOverride({ SURPRISEBOT_NIX_MODE: "true" }, async () => {
        const { isNixMode } = await import("./config.js");
        expect(isNixMode).toBe(false);
      });
    });

    it("isNixMode is true when SURPRISEBOT_NIX_MODE=1", async () => {
      await withEnvOverride({ SURPRISEBOT_NIX_MODE: "1" }, async () => {
        const { isNixMode } = await import("./config.js");
        expect(isNixMode).toBe(true);
      });
    });
  });

  describe("U5: CONFIG_PATH and STATE_DIR env var overrides", () => {
    it("STATE_DIR_SURPRISEBOT defaults to ~/.surprisebot when env not set", async () => {
      await withEnvOverride({ SURPRISEBOT_STATE_DIR: undefined }, async () => {
        const { STATE_DIR_SURPRISEBOT } = await import("./config.js");
        expect(STATE_DIR_SURPRISEBOT).toMatch(/\.surprisebot$/);
      });
    });

    it("STATE_DIR_SURPRISEBOT respects SURPRISEBOT_STATE_DIR override", async () => {
      await withEnvOverride({ SURPRISEBOT_STATE_DIR: "/custom/state/dir" }, async () => {
        const { STATE_DIR_SURPRISEBOT } = await import("./config.js");
        expect(STATE_DIR_SURPRISEBOT).toBe(path.resolve("/custom/state/dir"));
      });
    });

    it("CONFIG_PATH_SURPRISEBOT defaults to ~/.surprisebot/surprisebot.json when env not set", async () => {
      await withEnvOverride(
        { SURPRISEBOT_CONFIG_PATH: undefined, SURPRISEBOT_STATE_DIR: undefined },
        async () => {
          const { CONFIG_PATH_SURPRISEBOT } = await import("./config.js");
          expect(CONFIG_PATH_SURPRISEBOT).toMatch(/\.surprisebot[\\/]surprisebot\.json$/);
        },
      );
    });

    it("CONFIG_PATH_SURPRISEBOT respects SURPRISEBOT_CONFIG_PATH override", async () => {
      await withEnvOverride({ SURPRISEBOT_CONFIG_PATH: "/nix/store/abc/surprisebot.json" }, async () => {
        const { CONFIG_PATH_SURPRISEBOT } = await import("./config.js");
        expect(CONFIG_PATH_SURPRISEBOT).toBe(path.resolve("/nix/store/abc/surprisebot.json"));
      });
    });

    it("CONFIG_PATH_SURPRISEBOT expands ~ in SURPRISEBOT_CONFIG_PATH override", async () => {
      await withTempHome(async (home) => {
        await withEnvOverride({ SURPRISEBOT_CONFIG_PATH: "~/.surprisebot/custom.json" }, async () => {
          const { CONFIG_PATH_SURPRISEBOT } = await import("./config.js");
          expect(CONFIG_PATH_SURPRISEBOT).toBe(path.join(home, ".surprisebot", "custom.json"));
        });
      });
    });

    it("CONFIG_PATH_SURPRISEBOT uses STATE_DIR_SURPRISEBOT when only state dir is overridden", async () => {
      await withEnvOverride(
        {
          SURPRISEBOT_CONFIG_PATH: undefined,
          SURPRISEBOT_STATE_DIR: "/custom/state",
        },
        async () => {
          const { CONFIG_PATH_SURPRISEBOT } = await import("./config.js");
          expect(CONFIG_PATH_SURPRISEBOT).toBe(
            path.join(path.resolve("/custom/state"), "surprisebot.json"),
          );
        },
      );
    });
  });

  describe("U5b: tilde expansion for config paths", () => {
    it("expands ~ in common path-ish config fields", async () => {
      await withTempHome(async (home) => {
        const configDir = path.join(home, ".surprisebot");
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(
          path.join(configDir, "surprisebot.json"),
          JSON.stringify(
            {
              plugins: {
                load: {
                  paths: ["~/plugins/demo-plugin"],
                },
              },
              agents: {
                defaults: { workspace: "~/ws-default" },
                list: [
                  {
                    id: "main",
                    workspace: "~/ws-agent",
                    agentDir: "~/.surprisebot/agents/main",
                    sandbox: { workspaceRoot: "~/sandbox-root" },
                  },
                ],
              },
              channels: {
                whatsapp: {
                  accounts: {
                    personal: {
                      authDir: "~/.surprisebot/credentials/wa-personal",
                    },
                  },
                },
              },
            },
            null,
            2,
          ),
          "utf-8",
        );

        vi.resetModules();
        const { loadConfig } = await import("./config.js");
        const cfg = loadConfig();

        expect(cfg.plugins?.load?.paths?.[0]).toBe(path.join(home, "plugins", "demo-plugin"));
        expect(cfg.agents?.defaults?.workspace).toBe(path.join(home, "ws-default"));
        expect(cfg.agents?.list?.[0]?.workspace).toBe(path.join(home, "ws-agent"));
        expect(cfg.agents?.list?.[0]?.agentDir).toBe(
          path.join(home, ".surprisebot", "agents", "main"),
        );
        expect(cfg.agents?.list?.[0]?.sandbox?.workspaceRoot).toBe(path.join(home, "sandbox-root"));
        expect(cfg.channels?.whatsapp?.accounts?.personal?.authDir).toBe(
          path.join(home, ".surprisebot", "credentials", "wa-personal"),
        );
      });
    });
  });

  describe("U6: gateway port resolution", () => {
    it("uses default when env and config are unset", async () => {
      await withEnvOverride({ SURPRISEBOT_GATEWAY_PORT: undefined }, async () => {
        const { DEFAULT_GATEWAY_PORT, resolveGatewayPort } = await import("./config.js");
        expect(resolveGatewayPort({})).toBe(DEFAULT_GATEWAY_PORT);
      });
    });

    it("prefers SURPRISEBOT_GATEWAY_PORT over config", async () => {
      await withEnvOverride({ SURPRISEBOT_GATEWAY_PORT: "19001" }, async () => {
        const { resolveGatewayPort } = await import("./config.js");
        expect(resolveGatewayPort({ gateway: { port: 19002 } })).toBe(19001);
      });
    });

    it("falls back to config when env is invalid", async () => {
      await withEnvOverride({ SURPRISEBOT_GATEWAY_PORT: "nope" }, async () => {
        const { resolveGatewayPort } = await import("./config.js");
        expect(resolveGatewayPort({ gateway: { port: 19003 } })).toBe(19003);
      });
    });
  });

  describe("U9: telegram.tokenFile schema validation", () => {
    it("accepts config with only botToken", async () => {
      await withTempHome(async (home) => {
        const configDir = path.join(home, ".surprisebot");
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(
          path.join(configDir, "surprisebot.json"),
          JSON.stringify({
            channels: { telegram: { botToken: "123:ABC" } },
          }),
          "utf-8",
        );

        vi.resetModules();
        const { loadConfig } = await import("./config.js");
        const cfg = loadConfig();
        expect(cfg.channels?.telegram?.botToken).toBe("123:ABC");
        expect(cfg.channels?.telegram?.tokenFile).toBeUndefined();
      });
    });

    it("accepts config with only tokenFile", async () => {
      await withTempHome(async (home) => {
        const configDir = path.join(home, ".surprisebot");
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(
          path.join(configDir, "surprisebot.json"),
          JSON.stringify({
            channels: { telegram: { tokenFile: "/run/agenix/telegram-token" } },
          }),
          "utf-8",
        );

        vi.resetModules();
        const { loadConfig } = await import("./config.js");
        const cfg = loadConfig();
        expect(cfg.channels?.telegram?.tokenFile).toBe("/run/agenix/telegram-token");
        expect(cfg.channels?.telegram?.botToken).toBeUndefined();
      });
    });

    it("accepts config with both botToken and tokenFile", async () => {
      await withTempHome(async (home) => {
        const configDir = path.join(home, ".surprisebot");
        await fs.mkdir(configDir, { recursive: true });
        await fs.writeFile(
          path.join(configDir, "surprisebot.json"),
          JSON.stringify({
            channels: {
              telegram: {
                botToken: "fallback:token",
                tokenFile: "/run/agenix/telegram-token",
              },
            },
          }),
          "utf-8",
        );

        vi.resetModules();
        const { loadConfig } = await import("./config.js");
        const cfg = loadConfig();
        expect(cfg.channels?.telegram?.botToken).toBe("fallback:token");
        expect(cfg.channels?.telegram?.tokenFile).toBe("/run/agenix/telegram-token");
      });
    });
  });
});
