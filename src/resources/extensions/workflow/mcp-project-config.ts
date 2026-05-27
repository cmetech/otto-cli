import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertSafeDirectory } from "./validate-directory.js";
import { detectWorkflowMcpLaunchConfig } from "./workflow-mcp.js";

export const OTTO_WORKFLOW_MCP_SERVER_NAME = "otto-workflow";

export interface ProjectMcpServerConfig {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
}

export interface EnsureProjectWorkflowMcpConfigResult {
  configPath: string;
  serverName: string;
  status: "created" | "updated" | "unchanged";
}

interface McpConfigFile {
  mcpServers?: Record<string, ProjectMcpServerConfig>;
  servers?: Record<string, ProjectMcpServerConfig>;
  [key: string]: unknown;
}

export function resolveBundledWorkflowCliPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.OTTO_CLI_PATH?.trim() || env.OTTO_BIN_PATH?.trim();
  if (explicit) return explicit;

  const candidates = [
    resolve(fileURLToPath(new URL("../../../../scripts/dev-cli.js", import.meta.url))),
    resolve(fileURLToPath(new URL("../../../../dist/loader.js", import.meta.url))),
    resolve(fileURLToPath(new URL("../../../loader.js", import.meta.url))),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

export function buildProjectWorkflowMcpServerConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): ProjectMcpServerConfig {
  const resolvedProjectRoot = resolve(projectRoot);
  const workflowCliPath = resolveBundledWorkflowCliPath(env);
  const launch = detectWorkflowMcpLaunchConfig(resolvedProjectRoot, {
    ...env,
    ...(workflowCliPath ? { OTTO_CLI_PATH: workflowCliPath, OTTO_BIN_PATH: workflowCliPath } : {}),
  });

  if (!launch) {
    throw new Error(
      "Unable to resolve the OTTO workflow MCP server. Build this checkout or install otto-mcp-server on PATH.",
    );
  }

  return {
    command: launch.command,
    ...(launch.args && launch.args.length > 0 ? { args: launch.args } : {}),
    ...(launch.cwd ? { cwd: launch.cwd } : {}),
    ...(launch.env ? { env: launch.env } : {}),
  };
}

function readExistingConfig(configPath: string): McpConfigFile {
  if (!existsSync(configPath)) return {};

  const raw = readFileSync(configPath, "utf-8");
  try {
    const parsed = JSON.parse(raw) as McpConfigFile;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    throw new Error(
      `Failed to parse ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function ensureProjectWorkflowMcpConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): EnsureProjectWorkflowMcpConfigResult {
  const resolvedProjectRoot = resolve(projectRoot);
  assertSafeDirectory(resolvedProjectRoot);

  const configPath = resolve(resolvedProjectRoot, ".mcp.json");
  const existing = readExistingConfig(configPath);
  const desiredServer = buildProjectWorkflowMcpServerConfig(resolvedProjectRoot, env);
  const previousServers = existing.mcpServers ?? {};
  const nextServers = {
    ...previousServers,
    [OTTO_WORKFLOW_MCP_SERVER_NAME]: desiredServer,
  };

  const alreadyPresent = existsSync(configPath);
  const unchanged =
    JSON.stringify(previousServers[OTTO_WORKFLOW_MCP_SERVER_NAME] ?? null)
      === JSON.stringify(desiredServer)
    && existing.mcpServers !== undefined;

  if (unchanged) {
    return {
      configPath,
      serverName: OTTO_WORKFLOW_MCP_SERVER_NAME,
      status: "unchanged",
    };
  }

  const nextConfig: McpConfigFile = {
    ...existing,
    mcpServers: nextServers,
  };

  writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf-8");

  return {
    configPath,
    serverName: OTTO_WORKFLOW_MCP_SERVER_NAME,
    status: alreadyPresent ? "updated" : "created",
  };
}
