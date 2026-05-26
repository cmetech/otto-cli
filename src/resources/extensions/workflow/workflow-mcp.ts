import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface WorkflowMcpLaunchConfig {
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface WorkflowCapabilityOptions {
  projectRoot?: string;
  env?: NodeJS.ProcessEnv;
  surface?: string;
  unitType?: string;
  authMode?: "apiKey" | "oauth" | "externalCli" | "none";
  baseUrl?: string;
  activeTools?: string[];
}

const MCP_WORKFLOW_TOOL_SURFACE = new Set([
  "ask_user_questions",
  "otto_decision_save",
  "otto_exec",
  "otto_exec_search",
  "otto_resume",
  "otto_complete_milestone",
  "otto_complete_task",
  "otto_complete_slice",
  "otto_generate_milestone_id",
  "otto_journal_query",
  "otto_milestone_complete",
  "otto_milestone_generate_id",
  "otto_milestone_reopen",
  "otto_checkpoint_db",
  "otto_milestone_status",
  "otto_milestone_validate",
  "otto_plan_task",
  "otto_plan_milestone",
  "otto_plan_slice",
  "otto_replan_slice",
  "otto_reassess_roadmap",
  "otto_reopen_milestone",
  "otto_reopen_slice",
  "otto_reopen_task",
  "otto_requirement_save",
  "otto_requirement_update",
  "otto_roadmap_reassess",
  "otto_save_decision",
  "otto_save_gate_result",
  "otto_save_requirement",
  "otto_skip_slice",
  "otto_slice_replan",
  "otto_slice_complete",
  "otto_slice_reopen",
  "otto_summary_save",
  "otto_task_plan",
  "otto_task_complete",
  "otto_task_reopen",
  "otto_update_requirement",
  "otto_validate_milestone",
]);

function parseLookupOutput(output: Buffer | string): string {
  return output
    .toString()
    .trim()
    .split(/\r?\n/)[0] ?? "";
}

function parseJsonEnv<T>(env: NodeJS.ProcessEnv, name: string): T | undefined {
  const raw = env[name];
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Invalid JSON in ${name}`);
  }
}

function lookupCommand(command: string, platform: NodeJS.Platform = process.platform): string | null {
  const lookup = platform === "win32" ? `where ${command}` : `which ${command}`;
  try {
    const resolved = parseLookupOutput(execSync(lookup, { timeout: 5_000, stdio: "pipe" }));
    return resolved || null;
  } catch {
    return null;
  }
}

function findWorkflowCliFromAncestorPath(startPath: string): string | null {
  let current = resolve(startPath);

  while (true) {
    const candidate = resolve(current, "packages", "mcp-server", "dist", "cli.js");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

function getBundledWorkflowMcpCliPath(env: NodeJS.ProcessEnv): string | null {
  const envAnchors = [
    env.OTTO_BIN_PATH?.trim(),
    env.OTTO_CLI_PATH?.trim(),
    env.OTTO_WORKFLOW_PATH?.trim(),
    env.OTTO_WORKFLOW_PATH?.trim(),
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const anchor of envAnchors) {
    const candidate = findWorkflowCliFromAncestorPath(anchor);
    if (candidate) return candidate;
  }

  const candidates = [
    resolve(fileURLToPath(new URL("../../../../packages/mcp-server/src/cli.ts", import.meta.url))),
    resolve(fileURLToPath(new URL("../../../../../packages/mcp-server/src/cli.ts", import.meta.url))),
    resolve(fileURLToPath(new URL("../../../../packages/mcp-server/dist/cli.js", import.meta.url))),
    resolve(fileURLToPath(new URL("../../../../../packages/mcp-server/dist/cli.js", import.meta.url))),
  ];

  for (const bundledCli of candidates) {
    if (existsSync(bundledCli)) return bundledCli;
  }

  return null;
}

function getBundledWorkflowExecutorModulePath(): string | null {
  const candidates = [
    resolve(fileURLToPath(new URL("./tools/workflow-tool-executors.js", import.meta.url))),
    resolve(fileURLToPath(new URL("../../../../dist/resources/extensions/workflow/tools/workflow-tool-executors.js", import.meta.url))),
    resolve(fileURLToPath(new URL("./tools/workflow-tool-executors.ts", import.meta.url))),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function getBundledWorkflowWriteGateModulePath(): string | null {
  const candidates = [
    resolve(fileURLToPath(new URL("./bootstrap/write-gate.js", import.meta.url))),
    resolve(fileURLToPath(new URL("../../../../dist/resources/extensions/workflow/bootstrap/write-gate.js", import.meta.url))),
    resolve(fileURLToPath(new URL("./bootstrap/write-gate.ts", import.meta.url))),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function getResolveTsHookPath(): string | null {
  const candidates = [
    resolve(fileURLToPath(new URL("./tests/resolve-ts.mjs", import.meta.url))),
    resolve(fileURLToPath(new URL("../../../../src/resources/extensions/workflow/tests/resolve-ts.mjs", import.meta.url))),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

function mergeNodeOptions(existing: string | undefined, additions: string[]): string | undefined {
  const tokens = (existing ?? "").split(/\s+/).map((value) => value.trim()).filter(Boolean);
  for (const addition of additions) {
    if (!tokens.includes(addition)) {
      tokens.push(addition);
    }
  }
  return tokens.length > 0 ? tokens.join(" ") : undefined;
}

function buildWorkflowLaunchEnv(
  projectRoot: string,
  agentCliPath: string | undefined,
  explicitEnv?: Record<string, string>,
  workflowCliPath?: string,
): Record<string, string> {
  const executorModulePath = getBundledWorkflowExecutorModulePath();
  const writeGateModulePath = getBundledWorkflowWriteGateModulePath();
  const resolveTsHookPath = getResolveTsHookPath();
  const wantsSourceTs =
    Boolean(resolveTsHookPath) &&
    (
      (agentCliPath?.endsWith(".ts") ?? false) ||
      (workflowCliPath?.endsWith(".ts") ?? false) ||
      (executorModulePath?.endsWith(".ts") ?? false) ||
      (writeGateModulePath?.endsWith(".ts") ?? false)
    );
  const nodeOptions = wantsSourceTs
    ? mergeNodeOptions(explicitEnv?.NODE_OPTIONS, [
        "--experimental-strip-types",
        `--import=${pathToFileURL(resolveTsHookPath!).href}`,
      ])
    : explicitEnv?.NODE_OPTIONS;

  return {
    ...(explicitEnv ?? {}),
    ...(agentCliPath ? { OTTO_CLI_PATH: agentCliPath, OTTO_BIN_PATH: agentCliPath } : {}),
    ...(executorModulePath ? { OTTO_WORKFLOW_EXECUTORS_MODULE: executorModulePath } : {}),
    ...(writeGateModulePath ? { OTTO_WORKFLOW_WRITE_GATE_MODULE: writeGateModulePath } : {}),
    ...(nodeOptions ? { NODE_OPTIONS: nodeOptions } : {}),
    OTTO_PERSIST_WRITE_GATE_STATE: "1",
    OTTO_WORKFLOW_PROJECT_ROOT: projectRoot,
  };
}

export function detectWorkflowMcpLaunchConfig(
  projectRoot = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): WorkflowMcpLaunchConfig | null {
  const name = env.OTTO_WORKFLOW_MCP_NAME?.trim() || "otto-workflow";
  const explicitCommand = env.OTTO_WORKFLOW_MCP_COMMAND?.trim();
  const explicitArgs = parseJsonEnv<unknown>(env, "OTTO_WORKFLOW_MCP_ARGS");
  const explicitEnv = parseJsonEnv<Record<string, string>>(env, "OTTO_WORKFLOW_MCP_ENV");
  const explicitCwd = env.OTTO_WORKFLOW_MCP_CWD?.trim();
  const workflowCliPath =
    explicitEnv?.OTTO_CLI_PATH?.trim()
    || explicitEnv?.OTTO_BIN_PATH?.trim()
    || env.OTTO_CLI_PATH?.trim()
    || env.OTTO_BIN_PATH?.trim();
  const workflowProjectRoot =
    explicitEnv?.OTTO_WORKFLOW_PROJECT_ROOT?.trim() ||
    env.OTTO_WORKFLOW_PROJECT_ROOT?.trim() ||
    env.OTTO_PROJECT_ROOT?.trim() ||
    explicitCwd ||
    projectRoot;
  const resolvedWorkflowProjectRoot = resolve(workflowProjectRoot);

  if (explicitCommand) {
    const launchEnv = buildWorkflowLaunchEnv(resolve(workflowProjectRoot), workflowCliPath, explicitEnv);
    return {
      name,
      command: explicitCommand,
      args: Array.isArray(explicitArgs) && explicitArgs.length > 0 ? explicitArgs.map(String) : undefined,
      cwd: explicitCwd || undefined,
      env: Object.keys(launchEnv).length > 0 ? launchEnv : undefined,
    };
  }

  const distCli = resolve(resolvedWorkflowProjectRoot, "packages", "mcp-server", "dist", "cli.js");
  if (existsSync(distCli)) {
    return {
      name,
      command: process.execPath,
      args: [distCli],
      cwd: resolvedWorkflowProjectRoot,
      env: buildWorkflowLaunchEnv(resolvedWorkflowProjectRoot, workflowCliPath, undefined, distCli),
    };
  }

  const bundledCli = getBundledWorkflowMcpCliPath(env);
  if (bundledCli) {
    return {
      name,
      command: process.execPath,
      args: [bundledCli],
      cwd: resolvedWorkflowProjectRoot,
      env: buildWorkflowLaunchEnv(resolvedWorkflowProjectRoot, workflowCliPath, undefined, bundledCli),
    };
  }

  const binPath = lookupCommand("gsd-mcp-server");
  if (binPath) {
    return {
      name,
      command: binPath,
      env: buildWorkflowLaunchEnv(resolvedWorkflowProjectRoot, workflowCliPath),
    };
  }

  return null;
}

export function buildWorkflowMcpServers(
  projectRoot = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Record<string, Record<string, unknown>> | undefined {
  const launch = detectWorkflowMcpLaunchConfig(projectRoot, env);
  if (!launch) return undefined;

  return {
    [launch.name]: {
      command: launch.command,
      ...(launch.args && launch.args.length > 0 ? { args: launch.args } : {}),
      ...(launch.env ? { env: launch.env } : {}),
      ...(launch.cwd ? { cwd: launch.cwd } : {}),
    },
  };
}

export function getRequiredWorkflowToolsForGuidedUnit(unitType: string): string[] {
  switch (unitType) {
    case "discuss-project":
      return ["ask_user_questions", "otto_summary_save"];
    case "discuss-requirements":
      return ["ask_user_questions", "otto_requirement_save", "otto_summary_save"];
    case "research-decision":
      return ["ask_user_questions"];
    case "discuss-milestone":
      return [
        "otto_summary_save",
        "otto_requirement_save",
        "otto_requirement_update",
        "otto_plan_milestone",
        "otto_milestone_generate_id",
      ];
    case "discuss-slice":
      return ["otto_summary_save"];
    case "research-milestone":
    case "research-slice":
      return ["otto_summary_save"];
    case "plan-milestone":
      return ["otto_plan_milestone"];
    case "plan-slice":
      return ["otto_plan_slice"];
    case "execute-task":
      return ["otto_task_complete"];
    case "complete-slice":
      return ["otto_slice_complete", "otto_task_reopen", "otto_replan_slice"];
    default:
      return [];
  }
}

export function getRequiredWorkflowToolsForAutoUnit(unitType: string): string[] {
  switch (unitType) {
    case "discuss-project":
      return ["ask_user_questions", "otto_summary_save"];
    case "discuss-requirements":
      return ["ask_user_questions", "otto_requirement_save", "otto_summary_save"];
    case "research-decision":
      return ["ask_user_questions"];
    case "discuss-milestone":
      return [
        "otto_summary_save",
        "otto_requirement_save",
        "otto_requirement_update",
        "otto_plan_milestone",
        "otto_milestone_generate_id",
      ];
    case "research-milestone":
    case "research-slice":
    case "run-uat":
      return ["otto_summary_save"];
    case "plan-milestone":
      return ["otto_plan_milestone"];
    case "plan-slice":
      return ["otto_plan_slice"];
    case "execute-task":
    case "execute-task-simple":
    case "reactive-execute":
      return ["otto_task_complete"];
    case "complete-slice":
      return ["otto_slice_complete", "otto_task_reopen", "otto_replan_slice"];
    case "replan-slice":
      return ["otto_replan_slice"];
    case "reassess-roadmap":
      return ["otto_milestone_status", "otto_reassess_roadmap"];
    case "gate-evaluate":
      return ["otto_save_gate_result"];
    case "validate-milestone":
      return ["otto_milestone_status", "otto_validate_milestone", "otto_reassess_roadmap"];
    case "complete-milestone":
      return ["otto_milestone_status", "otto_complete_milestone"];
    default:
      return [];
  }
}

export function usesWorkflowMcpTransport(
  authMode: WorkflowCapabilityOptions["authMode"],
  baseUrl: string | undefined,
): boolean {
  return authMode === "externalCli" && typeof baseUrl === "string" && baseUrl.startsWith("local://");
}

function hasAskUserQuestionsTool(activeTools: string[]): boolean {
  return activeTools.some((toolName) => {
    if (toolName === "ask_user_questions") return true;
    if (!toolName.startsWith("mcp__")) return false;
    const toolSeparator = toolName.indexOf("__", "mcp__".length);
    return toolSeparator >= 0 && toolName.slice(toolSeparator + 2) === "ask_user_questions";
  });
}

function hasRequiredTool(requiredTool: string, activeTools: string[]): boolean {
  return activeTools.some((toolName) => {
    if (toolName === requiredTool) return true;
    if (!toolName.startsWith("mcp__")) return false;
    const toolSeparator = toolName.indexOf("__", "mcp__".length);
    return toolSeparator >= 0 && toolName.slice(toolSeparator + 2) === requiredTool;
  });
}

function workflowMcpStructuredQuestionsOptIn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.OTTO_WORKFLOW_MCP_STRUCTURED_QUESTIONS;
  return value === "1" || value === "true";
}

export function supportsStructuredQuestions(
  activeTools: string[],
  options: Pick<WorkflowCapabilityOptions, "authMode" | "baseUrl" | "env"> = {},
): boolean {
  if (!hasAskUserQuestionsTool(activeTools)) return false;
  if (usesWorkflowMcpTransport(options.authMode, options.baseUrl)) {
    // Claude Code local workflow-MCP exposes ask_user_questions, but form
    // elicitation can return an immediate cancel outside the agent's chat turn. Keep
    // checkpoints in plain chat unless a caller deliberately opts into testing
    // that transport.
    return workflowMcpStructuredQuestionsOptIn(options.env);
  }

  return true;
}

export function getWorkflowTransportSupportError(
  provider: string | undefined,
  requiredTools: string[],
  options: WorkflowCapabilityOptions = {},
): string | null {
  if (!provider || requiredTools.length === 0) return null;
  if (!usesWorkflowMcpTransport(options.authMode, options.baseUrl)) return null;

  const projectRoot = options.projectRoot ?? process.cwd();
  const env = options.env ?? process.env;
  const launch = detectWorkflowMcpLaunchConfig(projectRoot, env);
  const surface = options.surface ?? "workflow dispatch";
  const unitLabel = options.unitType ? ` for ${options.unitType}` : "";
  const providerLabel = `"${provider}"`;

  if (!launch) {
    return `Provider ${providerLabel} cannot run ${surface}${unitLabel}: the OTTO workflow MCP server is not configured or discoverable. Detected Claude Code model but no workflow MCP. Please run /otto mcp init . from your project root. You can also configure OTTO_WORKFLOW_MCP_COMMAND, build packages/mcp-server/dist/cli.js, or install gsd-mcp-server on PATH.`;
  }

  const uniqueRequired = [...new Set(requiredTools)];
  const missing = (options.activeTools && options.activeTools.length > 0)
    ? uniqueRequired.filter((tool) => !hasRequiredTool(tool, options.activeTools!))
    : uniqueRequired.filter((tool) => !MCP_WORKFLOW_TOOL_SURFACE.has(tool));
  if (missing.length === 0) return null;

  if (options.activeTools && options.activeTools.length > 0) {
    return `Provider ${providerLabel} cannot run ${surface}${unitLabel}: this unit requires ${missing.join(", ")}, but the active runtime toolset currently exposes only ${options.activeTools.slice().sort().join(", ")}.`;
  }

  return `Provider ${providerLabel} cannot run ${surface}${unitLabel}: this unit requires ${missing.join(", ")}, but the workflow MCP transport currently exposes only ${Array.from(MCP_WORKFLOW_TOOL_SURFACE).sort().join(", ")}.`;
}
