import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { registerHooks } from "../bootstrap/register-hooks.ts";
import { clearSkillSnapshot, snapshotSkills } from "../skill-discovery.js";
import { prepareWorkflowMcpForProject, shouldAutoPrepareWorkflowMcp } from "../workflow-mcp-auto-prep.ts";

test("shouldAutoPrepareWorkflowMcp enables prep for externalCli local transport", () => {
  const result = shouldAutoPrepareWorkflowMcp({
    model: { provider: "claude-code", baseUrl: "local://claude-code" },
    modelRegistry: {
      getProviderAuthMode: () => "externalCli",
      isProviderRequestReady: () => false,
    },
  });

  assert.equal(result, true);
});

test("shouldAutoPrepareWorkflowMcp stays disabled for non-Claude active provider even when claude-code is ready", () => {
  const result = shouldAutoPrepareWorkflowMcp({
    model: { provider: "openai", baseUrl: "https://api.openai.com" },
    modelRegistry: {
      getProviderAuthMode: () => "apiKey",
      isProviderRequestReady: (provider: string) => provider === "claude-code",
    },
  });

  assert.equal(result, false);
});

test("shouldAutoPrepareWorkflowMcp stays disabled for non-Claude active provider even when claude-code is registered", () => {
  const result = shouldAutoPrepareWorkflowMcp({
    model: { provider: "openai", baseUrl: "https://api.openai.com" },
    modelRegistry: {
      getProviderAuthMode: (provider: string) => provider === "claude-code" ? "externalCli" : "apiKey",
      isProviderRequestReady: () => false,
    },
  });

  assert.equal(result, false);
});

test("shouldAutoPrepareWorkflowMcp stays disabled when neither transport nor provider readiness match", () => {
  const result = shouldAutoPrepareWorkflowMcp({
    model: { provider: "openai", baseUrl: "https://api.openai.com" },
    modelRegistry: {
      getProviderAuthMode: () => "apiKey",
      isProviderRequestReady: () => false,
    },
  });

  assert.equal(result, false);
});

test("prepareWorkflowMcpForProject warns with /otto mcp init guidance when prep fails", () => {
  const notifications: Array<{ message: string; level: "info" | "warning" | "error" | "success" }> = [];
  const result = prepareWorkflowMcpForProject(
    {
      model: { provider: "claude-code", baseUrl: "local://claude-code" },
      modelRegistry: {
        getProviderAuthMode: () => "externalCli",
        isProviderRequestReady: () => true,
      },
      ui: {
        notify: (message: string, level?: "info" | "warning" | "error" | "success") => {
          notifications.push({ message, level: level ?? "info" });
        },
      },
    },
    "/",
  );

  assert.equal(result, null);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].level, "warning");
  assert.match(notifications[0].message, /Please run \/otto mcp init \./);
});

test("before_agent_start preserves discovered skill fallback without project .otto/workflow", async (t) => {
  // Regression for #108 (upstream 8dd6272). When there is no project
  // .otto/workflow root, buildBeforeAgentStartResult early-returns undefined,
  // so the discovered-skill prompt block must still survive into the chained
  // systemPrompt instead of falling back to the bare event.systemPrompt.
  const projectRoot = mkdtempSync(join(tmpdir(), "otto-skill-before-agent-"));
  const skillHome = mkdtempSync(join(tmpdir(), "otto-skill-home-"));
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const handlers = new Map<string, Array<(event: any, ctx?: any) => Promise<any> | any>>();
  const pi = {
    on(event: string, handler: (event: any, ctx?: any) => Promise<any> | any) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools() {},
  };

  t.after(() => {
    process.chdir(originalCwd);
    clearSkillSnapshot();
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(skillHome, { recursive: true, force: true });
  });

  // skill-discovery scans ~/.agents/skills and ~/.claude/skills via homedir(),
  // which honours HOME at call time on darwin/linux.
  process.env.HOME = skillHome;
  process.chdir(projectRoot);

  // Snapshot BEFORE the new skill exists so detectNewSkills() reports it.
  snapshotSkills();

  const skillDir = join(skillHome, ".agents", "skills", "late-skill");
  mkdirSync(skillDir, { recursive: true });
  const skillPath = join(skillDir, "SKILL.md");
  writeFileSync(skillPath, "---\nname: late-skill\ndescription: Use for late skill.\n---\n\n# late-skill\n");

  registerHooks(pi as any, []);
  const beforeAgentStart = handlers.get("before_agent_start")?.[0];
  assert.ok(beforeAgentStart, "before_agent_start hook should be registered");

  const result = await beforeAgentStart(
    { prompt: "hello", systemPrompt: "event system prompt" },
    {
      cwd: projectRoot,
      projectRoot,
      model: { provider: "openai", baseUrl: "https://api.openai.com" },
      modelRegistry: {
        getProviderAuthMode: () => "apiKey",
        isProviderRequestReady: () => false,
      },
      getSystemPrompt: () => "context system prompt",
      reload: async () => {},
      ui: {
        notify() {},
        setWidget() {},
      },
    },
  );

  assert.match(result?.systemPrompt ?? "", /<newly_discovered_skills>/);
  assert.match(result?.systemPrompt ?? "", /late-skill/);
  assert.equal(result?.systemPrompt?.includes(skillPath), true);
});
