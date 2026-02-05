import { describe, expect, it } from "vitest";
import type { SurprisebotConfig } from "../config/config.js";
import { createSurprisebotCodingTools } from "./pi-tools.js";
import type { SandboxDockerConfig } from "./sandbox.js";

describe("Agent-specific tool filtering", () => {
  it("should apply global tool policy when no agent-specific policy exists", () => {
    const cfg: SurprisebotConfig = {
      tools: {
        allow: ["read", "write"],
        deny: ["bash"],
      },
      agents: {
        list: [
          {
            id: "main",
            workspace: "~/surprisebot",
          },
        ],
      },
    };

    const tools = createSurprisebotCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test",
      agentDir: "/tmp/agent",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("write");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("apply_patch");
  });

  it("should keep global tool policy when agent only sets tools.elevated", () => {
    const cfg: SurprisebotConfig = {
      tools: {
        deny: ["write"],
      },
      agents: {
        list: [
          {
            id: "main",
            workspace: "~/surprisebot",
            tools: {
              elevated: {
                enabled: true,
                allowFrom: { whatsapp: ["+15555550123"] },
              },
            },
          },
        ],
      },
    };

    const tools = createSurprisebotCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test",
      agentDir: "/tmp/agent",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("exec");
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("apply_patch");
  });

  it("should allow apply_patch when exec is allow-listed and applyPatch is enabled", () => {
    const cfg: SurprisebotConfig = {
      tools: {
        allow: ["read", "exec"],
        exec: {
          applyPatch: { enabled: true },
        },
      },
    };

    const tools = createSurprisebotCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test",
      agentDir: "/tmp/agent",
      modelProvider: "openai",
      modelId: "gpt-5.2",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).toContain("exec");
    expect(toolNames).toContain("apply_patch");
  });

  it("should apply agent-specific tool policy", () => {
    const cfg: SurprisebotConfig = {
      tools: {
        allow: ["read", "write", "exec"],
        deny: [],
      },
      agents: {
        list: [
          {
            id: "restricted",
            workspace: "~/surprisebot-restricted",
            tools: {
              allow: ["read"], // Agent override: only read
              deny: ["exec", "write", "edit"],
            },
          },
        ],
      },
    };

    const tools = createSurprisebotCodingTools({
      config: cfg,
      sessionKey: "agent:restricted:main",
      workspaceDir: "/tmp/test-restricted",
      agentDir: "/tmp/agent-restricted",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("apply_patch");
    expect(toolNames).not.toContain("edit");
  });

  it("should apply provider-specific tool policy", () => {
    const cfg: SurprisebotConfig = {
      tools: {
        allow: ["read", "write", "exec"],
        byProvider: {
          "google-antigravity": {
            allow: ["read"],
          },
        },
      },
    };

    const tools = createSurprisebotCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test-provider",
      agentDir: "/tmp/agent-provider",
      modelProvider: "google-antigravity",
      modelId: "claude-opus-4-5-thinking",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("write");
    expect(toolNames).not.toContain("apply_patch");
  });

  it("should apply provider-specific tool profile overrides", () => {
    const cfg: SurprisebotConfig = {
      tools: {
        profile: "coding",
        byProvider: {
          "google-antigravity": {
            profile: "minimal",
          },
        },
      },
    };

    const tools = createSurprisebotCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test-provider-profile",
      agentDir: "/tmp/agent-provider-profile",
      modelProvider: "google-antigravity",
      modelId: "claude-opus-4-5-thinking",
    });

    const toolNames = tools.map((t) => t.name);
    expect(toolNames).toEqual(["session_status"]);
  });

  it("should allow different tool policies for different agents", () => {
    const cfg: SurprisebotConfig = {
      agents: {
        list: [
          {
            id: "main",
            workspace: "~/surprisebot",
            // No tools restriction - all tools available
          },
          {
            id: "family",
            workspace: "~/surprisebot-family",
            tools: {
              allow: ["read"],
              deny: ["exec", "write", "edit", "process"],
            },
          },
        ],
      },
    };

    // main agent: all tools
    const mainTools = createSurprisebotCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test-main",
      agentDir: "/tmp/agent-main",
    });
    const mainToolNames = mainTools.map((t) => t.name);
    expect(mainToolNames).toContain("exec");
    expect(mainToolNames).toContain("write");
    expect(mainToolNames).toContain("edit");
    expect(mainToolNames).not.toContain("apply_patch");

    // family agent: restricted
    const familyTools = createSurprisebotCodingTools({
      config: cfg,
      sessionKey: "agent:family:whatsapp:group:123",
      workspaceDir: "/tmp/test-family",
      agentDir: "/tmp/agent-family",
    });
    const familyToolNames = familyTools.map((t) => t.name);
    expect(familyToolNames).toContain("read");
    expect(familyToolNames).not.toContain("exec");
    expect(familyToolNames).not.toContain("write");
    expect(familyToolNames).not.toContain("edit");
    expect(familyToolNames).not.toContain("apply_patch");
  });

  it("should apply global tool policy before agent-specific policy", () => {
    const cfg: SurprisebotConfig = {
      tools: {
        deny: ["browser"], // Global deny
      },
      agents: {
        list: [
          {
            id: "work",
            workspace: "~/surprisebot-work",
            tools: {
              deny: ["exec", "process"], // Agent deny (override)
            },
          },
        ],
      },
    };

    const tools = createSurprisebotCodingTools({
      config: cfg,
      sessionKey: "agent:work:slack:dm:user123",
      workspaceDir: "/tmp/test-work",
      agentDir: "/tmp/agent-work",
    });

    const toolNames = tools.map((t) => t.name);
    // Global policy still applies; agent policy further restricts
    expect(toolNames).not.toContain("browser");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("process");
    expect(toolNames).not.toContain("apply_patch");
  });

  it("should work with sandbox tools filtering", () => {
    const cfg: SurprisebotConfig = {
      agents: {
        defaults: {
          sandbox: {
            mode: "all",
            scope: "agent",
          },
        },
        list: [
          {
            id: "restricted",
            workspace: "~/surprisebot-restricted",
            sandbox: {
              mode: "all",
              scope: "agent",
            },
            tools: {
              allow: ["read"], // Agent further restricts to only read
              deny: ["exec", "write"],
            },
          },
        ],
      },
      tools: {
        sandbox: {
          tools: {
            allow: ["read", "write", "exec"], // Sandbox allows these
            deny: [],
          },
        },
      },
    };

    const tools = createSurprisebotCodingTools({
      config: cfg,
      sessionKey: "agent:restricted:main",
      workspaceDir: "/tmp/test-restricted",
      agentDir: "/tmp/agent-restricted",
      sandbox: {
        enabled: true,
        sessionKey: "agent:restricted:main",
        workspaceDir: "/tmp/sandbox",
        agentWorkspaceDir: "/tmp/test-restricted",
        workspaceAccess: "none",
        containerName: "test-container",
        containerWorkdir: "/workspace",
        docker: {
          image: "test-image",
          containerPrefix: "test-",
          workdir: "/workspace",
          readOnlyRoot: true,
          tmpfs: [],
          network: "none",
          capDrop: [],
        } satisfies SandboxDockerConfig,
        tools: {
          allow: ["read", "write", "exec"],
          deny: [],
        },
        browserAllowHostControl: false,
      },
    });

    const toolNames = tools.map((t) => t.name);
    // Agent policy should be applied first, then sandbox
    // Agent allows only "read", sandbox allows ["read", "write", "exec"]
    // Result: only "read" (most restrictive wins)
    expect(toolNames).toContain("read");
    expect(toolNames).not.toContain("exec");
    expect(toolNames).not.toContain("write");
  });

  it("should run exec synchronously when process is denied", async () => {
    const cfg: SurprisebotConfig = {
      tools: {
        deny: ["process"],
      },
    };

    const tools = createSurprisebotCodingTools({
      config: cfg,
      sessionKey: "agent:main:main",
      workspaceDir: "/tmp/test-main",
      agentDir: "/tmp/agent-main",
    });
    const execTool = tools.find((tool) => tool.name === "exec");
    expect(execTool).toBeDefined();

    const result = await execTool?.execute("call1", {
      command: "echo done",
      yieldMs: 10,
    });

    expect(result?.details.status).toBe("completed");
  });
});
