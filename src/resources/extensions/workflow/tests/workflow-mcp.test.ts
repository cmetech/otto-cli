// Project/App: OTTO
// File Purpose: Tests workflow MCP launch config, tool surface, and stdio elicitation behavior.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

import {
  buildWorkflowMcpServers,
  detectWorkflowMcpLaunchConfig,
  getWorkflowTransportSupportError,
  getRequiredWorkflowToolsForAutoUnit,
  getRequiredWorkflowToolsForGuidedUnit,
  supportsStructuredQuestions,
  usesWorkflowMcpTransport,
} from "../workflow-mcp.ts";

const MCP_STDIO_TIMEOUT_MS = 90_000;

type ElicitPayload = {
  message: string;
  requestedSchema: { properties: Record<string, unknown>; required?: string[] };
};

function extractElicitPayload(request: unknown): ElicitPayload {
  const payload = (request as { params?: unknown }).params ?? request;
  return payload as ElicitPayload;
}

test("guided execute-task requires canonical task completion tool", () => {
  assert.deepEqual(getRequiredWorkflowToolsForGuidedUnit("execute-task"), ["otto_task_complete"]);
});

test("auto execute-task requires canonical task completion tool", () => {
  assert.deepEqual(getRequiredWorkflowToolsForAutoUnit("execute-task"), ["otto_task_complete"]);
});

test("complete-slice requires closeout and execution handoff tools", () => {
  const expected = ["otto_slice_complete", "otto_task_reopen", "otto_replan_slice"];
  assert.deepEqual(getRequiredWorkflowToolsForGuidedUnit("complete-slice"), expected);
  assert.deepEqual(getRequiredWorkflowToolsForAutoUnit("complete-slice"), expected);
});

test("deep project setup units declare required workflow MCP tools", () => {
  assert.deepEqual(getRequiredWorkflowToolsForGuidedUnit("discuss-project"), [
    "ask_user_questions",
    "otto_summary_save",
  ]);
  assert.deepEqual(getRequiredWorkflowToolsForGuidedUnit("discuss-requirements"), [
    "ask_user_questions",
    "otto_requirement_save",
    "otto_summary_save",
  ]);
  assert.deepEqual(getRequiredWorkflowToolsForGuidedUnit("research-decision"), [
    "ask_user_questions",
  ]);
  assert.deepEqual(getRequiredWorkflowToolsForAutoUnit("discuss-project"), [
    "ask_user_questions",
    "otto_summary_save",
  ]);
  assert.deepEqual(getRequiredWorkflowToolsForAutoUnit("discuss-requirements"), [
    "ask_user_questions",
    "otto_requirement_save",
    "otto_summary_save",
  ]);
  assert.deepEqual(getRequiredWorkflowToolsForAutoUnit("research-decision"), [
    "ask_user_questions",
  ]);
});

test("detectWorkflowMcpLaunchConfig prefers explicit env override", () => {
  const launch = detectWorkflowMcpLaunchConfig("/tmp/project", {
    OTTO_WORKFLOW_MCP_NAME: "workflow-tools",
    OTTO_WORKFLOW_MCP_COMMAND: "node",
    OTTO_WORKFLOW_MCP_ARGS: JSON.stringify(["dist/cli.js"]),
    OTTO_WORKFLOW_MCP_ENV: JSON.stringify({ FOO: "bar" }),
    OTTO_WORKFLOW_MCP_CWD: "/tmp/project",
    OTTO_CLI_PATH: "/tmp/otto",
  });

  assert.deepEqual(launch, {
    name: "workflow-tools",
    command: "node",
    args: ["dist/cli.js"],
    cwd: "/tmp/project",
    env: launch?.env,
  });
  assert.equal(launch?.env?.FOO, "bar");
  assert.equal(launch?.env?.OTTO_CLI_PATH, "/tmp/otto");
  assert.equal(launch?.env?.OTTO_BIN_PATH, "/tmp/otto");
  assert.equal(launch?.env?.OTTO_PERSIST_WRITE_GATE_STATE, "1");
  assert.equal(launch?.env?.OTTO_WORKFLOW_PROJECT_ROOT, "/tmp/project");
  assert.match(launch?.env?.OTTO_WORKFLOW_EXECUTORS_MODULE ?? "", /workflow-tool-executors\.(js|ts)$/);
  assert.match(launch?.env?.OTTO_WORKFLOW_WRITE_GATE_MODULE ?? "", /write-gate\.(js|ts)$/);
});

test("detectWorkflowMcpLaunchConfig normalizes explicit workflow MCP env CLI aliases", () => {
  const binOnly = detectWorkflowMcpLaunchConfig("/tmp/project", {
    OTTO_WORKFLOW_MCP_COMMAND: "node",
    OTTO_WORKFLOW_MCP_ENV: JSON.stringify({ OTTO_BIN_PATH: "/tmp/otto-bin" }),
  });
  assert.equal(binOnly?.env?.OTTO_CLI_PATH, "/tmp/otto-bin");
  assert.equal(binOnly?.env?.OTTO_BIN_PATH, "/tmp/otto-bin");

  const cliOnly = detectWorkflowMcpLaunchConfig("/tmp/project", {
    OTTO_WORKFLOW_MCP_COMMAND: "node",
    OTTO_WORKFLOW_MCP_ENV: JSON.stringify({ OTTO_CLI_PATH: "/tmp/otto-cli" }),
  });
  assert.equal(cliOnly?.env?.OTTO_CLI_PATH, "/tmp/otto-cli");
  assert.equal(cliOnly?.env?.OTTO_BIN_PATH, "/tmp/otto-cli");
});

test("buildWorkflowMcpServers mirrors explicit launch config", () => {
  const servers = buildWorkflowMcpServers("/tmp/project", {
    OTTO_WORKFLOW_MCP_COMMAND: "node",
    OTTO_WORKFLOW_MCP_ARGS: JSON.stringify(["dist/cli.js"]),
  });

  assert.deepEqual(servers, {
    "otto-workflow": {
      command: "node",
      args: ["dist/cli.js"],
      env: servers?.["otto-workflow"]?.env,
    },
  });
  assert.equal((servers?.["otto-workflow"]?.env as Record<string, string> | undefined)?.OTTO_PERSIST_WRITE_GATE_STATE, "1");
  assert.equal((servers?.["otto-workflow"]?.env as Record<string, string> | undefined)?.OTTO_WORKFLOW_PROJECT_ROOT, "/tmp/project");
  assert.match((servers?.["otto-workflow"]?.env as Record<string, string> | undefined)?.OTTO_WORKFLOW_EXECUTORS_MODULE ?? "", /workflow-tool-executors\.(js|ts)$/);
  assert.match((servers?.["otto-workflow"]?.env as Record<string, string> | undefined)?.OTTO_WORKFLOW_WRITE_GATE_MODULE ?? "", /write-gate\.(js|ts)$/);
});

test("detectWorkflowMcpLaunchConfig resolves the bundled server from OTTO_PROJECT_ROOT", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "otto-workflow-root-"));
  const worktreeRoot = mkdtempSync(join(tmpdir(), "otto-workflow-worktree-"));
  const cliPath = join(repoRoot, "packages", "mcp-server", "dist", "cli.js");

  mkdirSync(join(repoRoot, "packages", "mcp-server", "dist"), { recursive: true });
  writeFileSync(cliPath, "#!/usr/bin/env node\n", "utf-8");

  const launch = detectWorkflowMcpLaunchConfig(worktreeRoot, {
    OTTO_PROJECT_ROOT: repoRoot,
  });

  assert.deepEqual(launch, {
    name: "otto-workflow",
    command: process.execPath,
    args: [cliPath],
    cwd: repoRoot,
    env: launch?.env,
  });
  assert.equal(launch?.env?.OTTO_PERSIST_WRITE_GATE_STATE, "1");
  assert.equal(launch?.env?.OTTO_WORKFLOW_PROJECT_ROOT, repoRoot);
  assert.match(launch?.env?.OTTO_WORKFLOW_EXECUTORS_MODULE ?? "", /workflow-tool-executors\.(js|ts)$/);
  assert.match(launch?.env?.OTTO_WORKFLOW_WRITE_GATE_MODULE ?? "", /write-gate\.(js|ts)$/);
});

test("detectWorkflowMcpLaunchConfig resolves the bundled server from OTTO_BIN_PATH ancestry", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "otto-workflow-root-"));
  const worktreeRoot = mkdtempSync(join(tmpdir(), "otto-workflow-worktree-"));
  const cliPath = join(repoRoot, "packages", "mcp-server", "dist", "cli.js");
  const devCliPath = join(repoRoot, "scripts", "dev-cli.js");

  mkdirSync(join(repoRoot, "packages", "mcp-server", "dist"), { recursive: true });
  mkdirSync(join(repoRoot, "scripts"), { recursive: true });
  writeFileSync(cliPath, "#!/usr/bin/env node\n", "utf-8");
  writeFileSync(devCliPath, "#!/usr/bin/env node\n", "utf-8");

  const launch = detectWorkflowMcpLaunchConfig(worktreeRoot, {
    OTTO_BIN_PATH: devCliPath,
  });

  assert.deepEqual(launch, {
    name: "otto-workflow",
    command: process.execPath,
    args: [cliPath],
    cwd: worktreeRoot,
    env: launch?.env,
  });
  assert.equal(launch?.env?.OTTO_CLI_PATH, devCliPath);
  assert.equal(launch?.env?.OTTO_BIN_PATH, devCliPath);
  assert.equal(launch?.env?.OTTO_PERSIST_WRITE_GATE_STATE, "1");
  assert.equal(launch?.env?.OTTO_WORKFLOW_PROJECT_ROOT, worktreeRoot);
  assert.match(launch?.env?.OTTO_WORKFLOW_EXECUTORS_MODULE ?? "", /workflow-tool-executors\.(js|ts)$/);
  assert.match(launch?.env?.OTTO_WORKFLOW_WRITE_GATE_MODULE ?? "", /write-gate\.(js|ts)$/);
});

test("detectWorkflowMcpLaunchConfig resolves the bundled server relative to the installed OTTO package", () => {
  const launch = detectWorkflowMcpLaunchConfig("/tmp/project", {
    OTTO_BIN_PATH: "/tmp/otto-loader.js",
  });

  assert.equal(launch?.command, process.execPath);
  assert.equal(launch?.cwd, "/tmp/project");
  assert.equal(launch?.env?.OTTO_CLI_PATH, "/tmp/otto-loader.js");
  assert.equal(launch?.env?.OTTO_BIN_PATH, "/tmp/otto-loader.js");
  assert.equal(launch?.env?.OTTO_WORKFLOW_PROJECT_ROOT, "/tmp/project");
  assert.match(launch?.env?.OTTO_WORKFLOW_EXECUTORS_MODULE ?? "", /workflow-tool-executors\.(js|ts)$/);
  assert.match(launch?.env?.OTTO_WORKFLOW_WRITE_GATE_MODULE ?? "", /write-gate\.(js|ts)$/);
  assert.equal(typeof launch?.args?.[0], "string");
  assert.match(launch?.args?.[0] ?? "", /packages[\/\\]mcp-server[\/\\](dist[\/\\]cli\.js|src[\/\\]cli\.ts)$/);
  if ((launch?.args?.[0] ?? "").endsWith(".ts")) {
    assert.match(launch?.env?.NODE_OPTIONS ?? "", /--experimental-strip-types/);
    assert.match(launch?.env?.NODE_OPTIONS ?? "", /resolve-ts\.mjs/);
  }
});

test("detectWorkflowMcpLaunchConfig resolves the bundled server relative to the package without env hints", () => {
  const launch = detectWorkflowMcpLaunchConfig("/tmp/project", {});

  assert.equal(launch?.command, process.execPath);
  assert.equal(launch?.cwd, "/tmp/project");
  assert.equal(launch?.env?.OTTO_CLI_PATH, undefined);
  assert.equal(launch?.env?.OTTO_BIN_PATH, undefined);
  assert.equal(launch?.env?.OTTO_WORKFLOW_PROJECT_ROOT, "/tmp/project");
  assert.match(launch?.env?.OTTO_WORKFLOW_EXECUTORS_MODULE ?? "", /workflow-tool-executors\.(js|ts)$/);
  assert.match(launch?.env?.OTTO_WORKFLOW_WRITE_GATE_MODULE ?? "", /write-gate\.(js|ts)$/);
  assert.equal(typeof launch?.args?.[0], "string");
  assert.match(launch?.args?.[0] ?? "", /packages[\/\\]mcp-server[\/\\](dist[\/\\]cli\.js|src[\/\\]cli\.ts)$/);
  if ((launch?.args?.[0] ?? "").endsWith(".ts")) {
    assert.match(launch?.env?.NODE_OPTIONS ?? "", /--experimental-strip-types/);
    assert.match(launch?.env?.NODE_OPTIONS ?? "", /resolve-ts\.mjs/);
  }
});

test("workflow MCP launch config reaches mutation tools over stdio", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "otto-workflow-transport-"));
  mkdirSync(join(projectRoot, ".otto/workflow"), { recursive: true });
  // Isolate the spawned MCP server from the developer's real ~/.otto so it
  // can't pick up a configured Discord/Slack/Telegram channel from global
  // PREFERENCES.md and route ask_user_questions through a remote adapter
  // instead of MCP elicitation.
  const isolatedWorkflowHome = mkdtempSync(join(tmpdir(), "otto-workflow-home-"));

  const launch = detectWorkflowMcpLaunchConfig(projectRoot, {});
  assert.ok(launch, "expected a workflow MCP launch config");
  assert.match(
    launch.env?.OTTO_WORKFLOW_EXECUTORS_MODULE ?? "",
    /(dist[\/\\]resources[\/\\]extensions[\/\\]workflow[\/\\]tools[\/\\]workflow-tool-executors\.js|src[\/\\]resources[\/\\]extensions[\/\\]workflow[\/\\]tools[\/\\]workflow-tool-executors\.(js|ts))$/,
  );
  assert.match(
    launch.env?.OTTO_WORKFLOW_WRITE_GATE_MODULE ?? "",
    /(dist[\/\\]resources[\/\\]extensions[\/\\]workflow[\/\\]bootstrap[\/\\]write-gate\.js|src[\/\\]resources[\/\\]extensions[\/\\]workflow[\/\\]bootstrap[\/\\]write-gate\.(js|ts))$/,
  );
  if ((launch.env?.OTTO_WORKFLOW_EXECUTORS_MODULE ?? "").endsWith(".ts")) {
    assert.match(launch.env?.NODE_OPTIONS ?? "", /--experimental-strip-types/);
    assert.match(launch.env?.NODE_OPTIONS ?? "", /resolve-ts\.mjs/);
  }

  const client = new Client(
    { name: "workflow-mcp-transport-test", version: "1.0.0" },
    { capabilities: { elicitation: {} } },
  );
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    const elicitation = extractElicitPayload(request as unknown);

    assert.match(elicitation.message, /Please answer the following question/);
    assert.ok(elicitation.requestedSchema.properties.transport_mode);
    assert.ok(elicitation.requestedSchema.properties["transport_mode__note"]);
    assert.ok(elicitation.requestedSchema.required?.includes("transport_mode"));

    return {
      action: "accept",
      content: {
        transport_mode: "None of the above",
        transport_mode__note: "Need Windows-safe MCP elicitation.",
      },
    };
  });
  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: {
      ...process.env,
      ...launch.env,
      OTTO_HOME: isolatedWorkflowHome,
      DISCORD_BOT_TOKEN: "",
      SLACK_BOT_TOKEN: "",
      TELEGRAM_BOT_TOKEN: "",
    } as Record<string, string>,
    cwd: launch.cwd,
    stderr: "pipe",
  });

  try {
    await client.connect(transport, { timeout: MCP_STDIO_TIMEOUT_MS });

    const tools = await client.listTools(undefined, { timeout: MCP_STDIO_TIMEOUT_MS });
    assert.ok(
      (tools.tools ?? []).some((tool) => tool.name === "otto_plan_slice"),
      "expected workflow MCP surface to expose otto_plan_slice",
    );
    assert.ok(
      (tools.tools ?? []).some((tool) => tool.name === "ask_user_questions"),
      "expected workflow MCP surface to expose ask_user_questions",
    );

    const askResult = await client.callTool(
      {
        name: "ask_user_questions",
        arguments: {
          questions: [
            {
              id: "transport_mode",
              header: "Transport",
              question: "How should the workflow prompt be delivered?",
              options: [
                { label: "Local UI", description: "Use the host tool UI." },
                { label: "Remote UI", description: "Use a remote response channel." },
              ],
            },
          ],
        },
      },
      undefined,
      { timeout: MCP_STDIO_TIMEOUT_MS },
    );
    assert.equal(askResult.isError, undefined);
    assert.equal(
      ((askResult.content as Array<{ text?: string }>)?.[0])?.text ?? "",
      JSON.stringify({
        answers: {
          transport_mode: {
            answers: ["None of the above", "user_note: Need Windows-safe MCP elicitation."],
          },
        },
      }),
    );

    const milestoneResult = await client.callTool(
      {
        name: "otto_plan_milestone",
        arguments: {
          projectDir: projectRoot,
          milestoneId: "M001",
          title: "Transport planning",
          vision: "Verify stdio workflow MCP uses the executor bridge.",
          slices: [
            {
              sliceId: "S01",
              title: "Bridge path",
              risk: "low",
              depends: [],
              demo: "Milestone planning succeeds over stdio MCP.",
              goal: "Prove the executor bridge works in the spawned server.",
              successCriteria: "otto_plan_slice can write plan artifacts.",
              proofLevel: "integration",
              integrationClosure: "Stdio MCP client reaches the workflow executor bridge.",
              observabilityImpact: "Regression test covers the spawned-server path.",
            },
          ],
        },
      },
      undefined,
      { timeout: MCP_STDIO_TIMEOUT_MS },
    );
    assert.equal(milestoneResult.isError, undefined);
    assert.match(
      ((milestoneResult.content as Array<{ text?: string }>)?.[0])?.text ?? "",
      /Planned milestone M001/,
    );

    const sliceResult = await client.callTool(
      {
        name: "otto_plan_slice",
        arguments: {
          projectDir: projectRoot,
          milestoneId: "M001",
          sliceId: "S01",
          goal: "Persist slice planning over the spawned MCP transport.",
          tasks: [
            {
              taskId: "T01",
              title: "Connect the bridge",
              description: "Ensure the workflow executor bridge resolves in the child process.",
              estimate: "10m",
              files: ["src/resources/extensions/workflow/workflow-mcp.ts"],
              verify: "node --test",
              inputs: [".otto/workflow/milestones/M001/M001-ROADMAP.md"],
              expectedOutput: ["S01-PLAN.md", "T01-PLAN.md"],
            },
          ],
        },
      },
      undefined,
      { timeout: MCP_STDIO_TIMEOUT_MS },
    );
    assert.equal(sliceResult.isError, undefined);
    assert.match(
      ((sliceResult.content as Array<{ text?: string }>)?.[0])?.text ?? "",
      /Planned slice S01/,
    );
    assert.ok(
      existsSync(join(projectRoot, ".otto/workflow", "milestones", "M001", "slices", "S01", "S01-PLAN.md")),
      "expected slice plan artifact to be written through stdio MCP",
    );
    assert.ok(
      existsSync(
        join(projectRoot, ".otto/workflow", "milestones", "M001", "slices", "S01", "tasks", "T01-PLAN.md"),
      ),
      "expected task plan artifact to be written through stdio MCP",
    );
  } finally {
    await client.close().catch(() => {});
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(isolatedWorkflowHome, { recursive: true, force: true });
  }
});

test("workflow MCP ask_user_questions uses stdio elicitation round-trip", async () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "otto-workflow-elicit-"));
  mkdirSync(join(projectRoot, ".otto/workflow"), { recursive: true });
  const isolatedWorkflowHome = mkdtempSync(join(tmpdir(), "otto-workflow-home-"));

  const launch = detectWorkflowMcpLaunchConfig(projectRoot, {});
  assert.ok(launch, "expected a workflow MCP launch config");

  const client = new Client(
    { name: "workflow-mcp-elicit-test", version: "1.0.0" },
    { capabilities: { elicitation: {} } },
  );
  let requestSeen: {
    message: string;
    requestedSchema: { properties: Record<string, unknown>; required?: string[] };
  } | null = null;

  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    const params = extractElicitPayload(request as unknown);

    requestSeen = params;

    return {
      action: "accept",
      content: {
        deployment: "None of the above",
        deployment__note: "Need hybrid deployment.",
      },
    };
  });

  const transport = new StdioClientTransport({
    command: launch.command,
    args: launch.args,
    env: {
      ...process.env,
      ...launch.env,
      OTTO_HOME: isolatedWorkflowHome,
      DISCORD_BOT_TOKEN: "",
      SLACK_BOT_TOKEN: "",
      TELEGRAM_BOT_TOKEN: "",
    } as Record<string, string>,
    cwd: launch.cwd,
    stderr: "pipe",
  });

  try {
    await client.connect(transport, { timeout: MCP_STDIO_TIMEOUT_MS });

    const result = await client.callTool(
      {
        name: "ask_user_questions",
        arguments: {
          questions: [
            {
              id: "deployment",
              header: "Deploy",
              question: "Where will this run?",
              options: [
                { label: "Cloud", description: "Managed hosting." },
                { label: "On-prem", description: "Runs in customer infrastructure." },
              ],
            },
          ],
        },
      },
      undefined,
      { timeout: MCP_STDIO_TIMEOUT_MS },
    );

    assert.ok(requestSeen, "expected stdio transport to forward an elicitation request");
    const seen = requestSeen as ElicitPayload;
    assert.match(seen.message, /Please answer the following question/);
    assert.ok(seen.requestedSchema.properties.deployment);
    assert.ok(seen.requestedSchema.properties.deployment__note);
    assert.ok(seen.requestedSchema.required?.includes("deployment"));

    const content = (result as { content: Array<{ type: string; text?: string }> }).content;
    const text = content.find((item: { type: string; text?: string }) => item.type === "text");
    assert.ok(text && "text" in text);
    assert.equal(
      text.text,
      JSON.stringify({
        answers: {
          deployment: {
            answers: ["None of the above", "user_note: Need hybrid deployment."],
          },
        },
      }),
    );
  } finally {
    await client.close();
    rmSync(projectRoot, { recursive: true, force: true });
    rmSync(isolatedWorkflowHome, { recursive: true, force: true });
  }
});

test("usesWorkflowMcpTransport matches local externalCli providers", () => {
  assert.equal(usesWorkflowMcpTransport("externalCli", "local://claude-code"), true);
  assert.equal(usesWorkflowMcpTransport("externalCli", "https://api.example.com"), false);
  assert.equal(usesWorkflowMcpTransport("oauth", "local://custom"), false);
});

test("supportsStructuredQuestions disables local workflow MCP questions unless explicitly enabled", () => {
  assert.equal(
    supportsStructuredQuestions(["ask_user_questions"], {
      authMode: "externalCli",
      baseUrl: "local://claude-code",
      env: {},
    }),
    false,
  );
  assert.equal(
    supportsStructuredQuestions(["mcp__otto-workflow__ask_user_questions"], {
      authMode: "externalCli",
      baseUrl: "local://claude-code",
      env: { OTTO_WORKFLOW_MCP_STRUCTURED_QUESTIONS: "1" } as NodeJS.ProcessEnv,
    }),
    true,
  );
  assert.equal(
    supportsStructuredQuestions(["ask_user_questions"], {
      authMode: "oauth",
      baseUrl: "https://api.anthropic.com",
    }),
    true,
  );
  assert.equal(
    supportsStructuredQuestions([], {
      authMode: "oauth",
      baseUrl: "https://api.anthropic.com",
    }),
    false,
  );
});

test("transport compatibility passes when required tools fit current MCP surface", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["otto_task_complete"],
    {
      projectRoot: "/tmp/project",
      env: { OTTO_WORKFLOW_MCP_COMMAND: "node" },
      surface: "guided flow",
      unitType: "execute-task",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
    },
  );

  assert.equal(error, null);
});

test("transport compatibility discovers the bundled MCP server without env overrides", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["otto_task_complete"],
    {
      projectRoot: "/tmp/project",
      env: {},
      surface: "auto-mode",
      unitType: "execute-task",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
    },
  );

  assert.equal(error, null);
});

test("transport compatibility now allows auto execute-task over workflow MCP surface", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["otto_complete_task"],
    {
      projectRoot: "/tmp/project",
      env: { OTTO_WORKFLOW_MCP_COMMAND: "node" },
      surface: "auto-mode",
      unitType: "execute-task",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
    },
  );

  assert.equal(error, null);
});

test("transport compatibility ignores API-backed providers", () => {
  const error = getWorkflowTransportSupportError(
    "openai-codex",
    ["otto_plan_slice"],
    {
      projectRoot: "/tmp/project",
      env: {},
      surface: "auto-mode",
      unitType: "plan-slice",
      authMode: "oauth",
      baseUrl: "https://api.openai.com",
    },
  );

  assert.equal(error, null);
});

test("transport compatibility now allows plan-slice over workflow MCP surface", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["otto_plan_slice"],
    {
      projectRoot: "/tmp/project",
      env: { OTTO_WORKFLOW_MCP_COMMAND: "node" },
      surface: "auto-mode",
      unitType: "plan-slice",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
    },
  );

  assert.equal(error, null);
});

test("transport compatibility now allows complete-slice over workflow MCP surface", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["otto_complete_slice"],
    {
      projectRoot: "/tmp/project",
      env: { OTTO_WORKFLOW_MCP_COMMAND: "node" },
      surface: "auto-mode",
      unitType: "complete-slice",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
    },
  );

  assert.equal(error, null);
});

test("transport compatibility now allows reassess-roadmap over workflow MCP surface", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["otto_milestone_status", "otto_reassess_roadmap"],
    {
      projectRoot: "/tmp/project",
      env: { OTTO_WORKFLOW_MCP_COMMAND: "node" },
      surface: "auto-mode",
      unitType: "reassess-roadmap",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
    },
  );

  assert.equal(error, null);
});

test("transport compatibility now allows gate-evaluate over workflow MCP surface", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["otto_save_gate_result"],
    {
      projectRoot: "/tmp/project",
      env: { OTTO_WORKFLOW_MCP_COMMAND: "node" },
      surface: "auto-mode",
      unitType: "gate-evaluate",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
    },
  );

  assert.equal(error, null);
});

test("transport compatibility now allows validate-milestone over workflow MCP surface", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["otto_milestone_status", "otto_validate_milestone"],
    {
      projectRoot: "/tmp/project",
      env: { OTTO_WORKFLOW_MCP_COMMAND: "node" },
      surface: "auto-mode",
      unitType: "validate-milestone",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
    },
  );

  assert.equal(error, null);
});

test("transport compatibility now allows complete-milestone over workflow MCP surface", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["otto_milestone_status", "otto_complete_milestone"],
    {
      projectRoot: "/tmp/project",
      env: { OTTO_WORKFLOW_MCP_COMMAND: "node" },
      surface: "auto-mode",
      unitType: "complete-milestone",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
    },
  );

  assert.equal(error, null);
});

test("transport compatibility now allows replan-slice over workflow MCP surface", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["otto_replan_slice"],
    {
      projectRoot: "/tmp/project",
      env: { OTTO_WORKFLOW_MCP_COMMAND: "node" },
      surface: "auto-mode",
      unitType: "replan-slice",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
    },
  );

  assert.equal(error, null);
});

test("transport compatibility still blocks units whose MCP tools are not exposed", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["secure_env_collect"],
    {
      projectRoot: "/tmp/project",
      env: { OTTO_WORKFLOW_MCP_COMMAND: "node" },
      surface: "auto-mode",
      unitType: "guided-discussion",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
    },
  );

  assert.match(error ?? "", /requires secure_env_collect/);
  assert.match(error ?? "", /currently exposes only/);
});

test("transport compatibility accepts MCP-namespaced runtime tools", () => {
  const error = getWorkflowTransportSupportError(
    "claude-code",
    ["otto_summary_save"],
    {
      projectRoot: "/tmp/project",
      env: { OTTO_WORKFLOW_MCP_COMMAND: "node" },
      surface: "auto-mode",
      unitType: "research-slice",
      authMode: "externalCli",
      baseUrl: "local://claude-code",
      activeTools: ["mcp__otto-workflow__otto_summary_save"],
    },
  );

  assert.equal(error, null);
});
