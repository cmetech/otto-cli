import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "@sinclair/typebox";
import type { AgentToolResult, ExtensionAPI, ToolDefinition } from "@otto/pi-coding-agent";

import { LangFlowClient, type LangFlowSummary } from "../clients/langflow.js";
import { resolveLangFlowArtifacts } from "../langflow/artifacts.js";
import { effectiveLangFlowConfig } from "../langflow/config.js";
import {
  buildFlowRuntimeDefaults,
  composeBuildFlowPrompt,
  probeLocalOttoGateway,
} from "../commands/build-flow/command.js";
import { ensureRepoConventions } from "../commands/build-flow/_scaffold.js";
import { loadReferenceDocs } from "../commands/build-flow/_system-context.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = resolve(_here, "..", "samples", "langflow");

export const LANGFLOW_TOOL_ACTIONS = [
  "status",
  "list_flows",
  "show_flow",
  "import_flow",
  "export_flow",
  "delete_flow",
  "run_flow",
  "build_flow",
] as const;

export type LangFlowToolAction = typeof LANGFLOW_TOOL_ACTIONS[number];

const Params = Type.Object({
  action: Type.Union(LANGFLOW_TOOL_ACTIONS.map((action) => Type.Literal(action)), {
    description: "LangFlow action to perform.",
  }),
  flow: Type.Optional(Type.String({
    description: "Flow id, name, or endpoint name for show/export/delete/run.",
  })),
  prefix: Type.Optional(Type.String({
    description: "Optional case-insensitive prefix filter for list_flows.",
  })),
  file: Type.Optional(Type.String({
    description: "Flow JSON file path or sample/generated/imported file name for import_flow.",
  })),
  input: Type.Optional(Type.String({
    description: "Input text for run_flow.",
  })),
  description: Type.Optional(Type.String({
    description: "Natural-language flow description for build_flow.",
  })),
  out: Type.Optional(Type.String({
    description: "Output file path for export_flow. Defaults to .otto/langflow/exported/<flow-name>.json.",
  })),
  overwrite: Type.Optional(Type.Boolean({
    description: "Allow export_flow to overwrite an existing output file.",
    default: false,
  })),
  update: Type.Optional(Type.Boolean({
    description: "Update an existing matching flow during import_flow.",
    default: false,
  })),
  replace: Type.Optional(Type.Boolean({
    description: "Delete an existing matching flow before import_flow.",
    default: false,
  })),
  createNew: Type.Optional(Type.Boolean({
    description: "Import as a new flow even when a matching flow exists.",
    default: false,
  })),
  confirmDelete: Type.Optional(Type.Boolean({
    description: "Required true for delete_flow.",
    default: false,
  })),
});

type Params = Static<typeof Params>;

interface LangFlowToolDetails {
  action: LangFlowToolAction;
  flowId?: string;
  path?: string;
  count?: number;
  connectionIssue?: boolean;
}

function result(text: string, details: LangFlowToolDetails, isError = false): AgentToolResult<LangFlowToolDetails> {
  return { content: [{ type: "text", text }], details, ...(isError ? { isError: true } : {}) };
}

function makeClient(): LangFlowClient {
  const cfg = effectiveLangFlowConfig();
  return new LangFlowClient({ baseUrl: cfg.url, apiKey: cfg.apiKey ?? undefined });
}

function requireEnabled(action: LangFlowToolAction): AgentToolResult<LangFlowToolDetails> | undefined {
  const cfg = effectiveLangFlowConfig();
  if (cfg.enabled) return undefined;
  return result("LangFlow is disabled. Run `/otto langflow connect [url]` or ask to connect LangFlow first.", { action }, true);
}

function connectionFailureResult(
  action: LangFlowToolAction,
  message: string,
): AgentToolResult<LangFlowToolDetails> | undefined {
  if (!/\b(401|403)\b|authentication|credentials|forbidden|unauthorized/i.test(message)) return undefined;
  return result(
    [
      "LangFlow is not connected or authentication is missing.",
      "Run `/otto langflow connect`, provide the LangFlow URL/API key if prompted, then retry the request.",
      "Do not retry this LangFlow action until the connection is configured.",
    ].join(" "),
    { action, connectionIssue: true },
    true,
  );
}

function ensureArtifactDirs(projectRoot: string): ReturnType<typeof resolveLangFlowArtifacts> {
  const paths = resolveLangFlowArtifacts(projectRoot);
  for (const dir of [paths.root, paths.generated, paths.imported, paths.exported, paths.samples, paths.catalog, paths.runs]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "flow";
}

function flowIdentity(payload: unknown): { id?: string; name?: string; endpointName?: string } {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  return {
    id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : undefined,
    name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : undefined,
    endpointName:
      typeof record.endpoint_name === "string" && record.endpoint_name.trim() ? record.endpoint_name.trim() :
      typeof record.endpointName === "string" && record.endpointName.trim() ? record.endpointName.trim() :
      undefined,
  };
}

function findFlow(input: string, flows: LangFlowSummary[]): LangFlowSummary | undefined {
  const lowered = input.toLowerCase();
  return flows.find((flow) =>
    flow.id === input ||
    flow.name.toLowerCase() === lowered ||
    flow.endpointName?.toLowerCase() === lowered
  );
}

function findMatchingImportedFlow(payload: unknown, flows: LangFlowSummary[]): LangFlowSummary | undefined {
  const identity = flowIdentity(payload);
  if (identity.id) {
    const byId = flows.find((flow) => flow.id === identity.id);
    if (byId) return byId;
  }
  if (identity.endpointName) {
    const endpoint = identity.endpointName.toLowerCase();
    const byEndpoint = flows.find((flow) => flow.endpointName?.toLowerCase() === endpoint);
    if (byEndpoint) return byEndpoint;
  }
  if (identity.name) {
    const name = identity.name.toLowerCase();
    return flows.find((flow) => flow.name.toLowerCase() === name);
  }
  return undefined;
}

function resolveFlowJson(projectRoot: string, arg: string): { path: string; payload: unknown } {
  const paths = ensureArtifactDirs(projectRoot);
  const candidates = [
    resolve(projectRoot, arg),
    resolve(paths.generated, arg),
    resolve(paths.generated, arg.endsWith(".json") ? arg : `${arg}.json`),
    resolve(paths.imported, arg),
    resolve(paths.imported, arg.endsWith(".json") ? arg : `${arg}.json`),
    resolve(paths.samples, arg),
    resolve(paths.samples, arg.endsWith(".json") ? arg : `${arg}.json`),
    resolve(SAMPLE_DIR, arg),
    resolve(SAMPLE_DIR, arg.endsWith(".json") ? arg : `${arg}.json`),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Flow JSON not found: ${arg}`);
  return { path: found, payload: JSON.parse(readFileSync(found, "utf-8")) as unknown };
}

function formatFlows(flows: LangFlowSummary[]): string {
  if (flows.length === 0) return "No LangFlow flows matched.";
  return flows.map((flow) => `- ${flow.name} (${flow.id})${flow.endpointName ? ` endpoint=${flow.endpointName}` : ""}`).join("\n");
}

async function resolveExistingFlow(client: LangFlowClient, flow: string): Promise<LangFlowSummary | undefined> {
  return findFlow(flow, await client.listFlows());
}

export async function executeLangFlowTool(params: Params, projectRoot: string, pi: Pick<ExtensionAPI, "sendMessage">): Promise<AgentToolResult<LangFlowToolDetails>> {
  if (params.action !== "build_flow") {
    const disabled = requireEnabled(params.action);
    if (disabled) return disabled;
  }

  try {
    switch (params.action) {
      case "status": {
        const cfg = effectiveLangFlowConfig();
        if (!cfg.enabled) return result(`LangFlow disabled (${cfg.url}).`, { action: params.action });
        const version = await makeClient().getVersion(1500);
        return version
          ? result(`LangFlow connected at ${cfg.url} (v${version.version}).`, { action: params.action })
          : result(`LangFlow configured at ${cfg.url}, but health check failed. Run \`/otto langflow connect\` if this server requires authentication.`, { action: params.action }, true);
      }
      case "list_flows": {
        const prefix = params.prefix?.trim().toLowerCase();
        let flows = await makeClient().listFlows();
        if (prefix) {
          flows = flows.filter((flow) =>
            flow.name.toLowerCase().startsWith(prefix) ||
            flow.id.toLowerCase().startsWith(prefix) ||
            flow.endpointName?.toLowerCase().startsWith(prefix)
          );
        }
        return result(formatFlows(flows), { action: params.action, count: flows.length });
      }
      case "show_flow": {
        if (!params.flow?.trim()) return result("show_flow requires `flow`.", { action: params.action }, true);
        const client = makeClient();
        const flow = await resolveExistingFlow(client, params.flow) ?? { id: params.flow };
        const raw = await client.getFlow(flow.id);
        return result(JSON.stringify(raw, null, 2), { action: params.action, flowId: flow.id });
      }
      case "import_flow": {
        if (!params.file?.trim()) return result("import_flow requires `file`.", { action: params.action }, true);
        const paths = ensureArtifactDirs(projectRoot);
        const source = resolveFlowJson(projectRoot, params.file);
        const client = makeClient();
        const existing = findMatchingImportedFlow(source.payload, await client.listFlows());
        if (existing && !params.update && !params.replace && !params.createNew) {
          return result(
            `LangFlow flow already exists: ${existing.name} (${existing.id}). Set update, replace, or createNew.`,
            { action: params.action, flowId: existing.id },
            true,
          );
        }
        if (existing && params.update) {
          await client.updateFlow(existing.id, source.payload);
          copyFileSync(source.path, join(paths.imported, basename(source.path)));
          return result(`Updated LangFlow flow ${existing.id} from ${basename(source.path)}.`, { action: params.action, flowId: existing.id });
        }
        if (existing && params.replace) {
          await client.deleteFlow(existing.id);
        }
        const imported = await client.importFlow(source.payload);
        copyFileSync(source.path, join(paths.imported, basename(source.path)));
        const id = typeof imported === "object" && imported && "id" in imported ? String((imported as { id: unknown }).id) : undefined;
        return result(`Imported LangFlow flow ${id ?? "unknown"} from ${basename(source.path)}.`, { action: params.action, flowId: id });
      }
      case "export_flow": {
        if (!params.flow?.trim()) return result("export_flow requires `flow`.", { action: params.action }, true);
        const paths = ensureArtifactDirs(projectRoot);
        const client = makeClient();
        const flow = await resolveExistingFlow(client, params.flow);
        const flowId = flow?.id ?? params.flow;
        const raw = await client.getFlow(flowId);
        const name = flow?.name ?? (flowIdentity(raw).name ?? flowId);
        const outPath = params.out?.trim() ? resolve(projectRoot, params.out) : join(paths.exported, `${slugify(name)}.json`);
        if (existsSync(outPath) && !params.overwrite) {
          return result(`Refusing to overwrite existing file: ${outPath}. Set overwrite true.`, { action: params.action, flowId, path: outPath }, true);
        }
        writeFileSync(outPath, JSON.stringify(raw, null, 2) + "\n");
        return result(`Exported LangFlow flow ${flowId} to ${outPath}.`, { action: params.action, flowId, path: outPath });
      }
      case "delete_flow": {
        if (!params.flow?.trim()) return result("delete_flow requires `flow`.", { action: params.action }, true);
        if (!params.confirmDelete) return result("delete_flow requires confirmDelete: true.", { action: params.action }, true);
        const client = makeClient();
        const flow = await resolveExistingFlow(client, params.flow);
        const flowId = flow?.id ?? params.flow;
        await client.deleteFlow(flowId);
        return result(`Deleted LangFlow flow ${flowId}.`, { action: params.action, flowId });
      }
      case "run_flow": {
        if (!params.flow?.trim()) return result("run_flow requires `flow`.", { action: params.action }, true);
        if (!params.input?.trim()) return result("run_flow requires `input`.", { action: params.action }, true);
        const client = makeClient();
        const flow = await resolveExistingFlow(client, params.flow);
        const flowId = flow?.id ?? params.flow;
        const run = await client.runFlow(flowId, { input_value: params.input, input_type: "chat", output_type: "chat" });
        const paths = ensureArtifactDirs(projectRoot);
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const runPath = join(paths.runs, `${stamp}.json`);
        writeFileSync(runPath, JSON.stringify({ at: new Date().toISOString(), flow: flowId, input: params.input, text: run.text, raw: run.raw }, null, 2) + "\n");
        return result(`${run.text}\n\nRun saved: ${runPath}`, { action: params.action, flowId, path: runPath });
      }
      case "build_flow": {
        if (!params.description?.trim()) return result("build_flow requires `description`.", { action: params.action }, true);
        ensureArtifactDirs(projectRoot);
        try {
          await ensureRepoConventions(projectRoot);
        } catch {
          // Artifact dirs are enough for the tool path; continue with the builder prompt.
        }
        const referenceContext = await loadReferenceDocs();
        const prompt = composeBuildFlowPrompt({
          description: params.description,
          referenceContext,
          runtimeDefaults: buildFlowRuntimeDefaults({
            localGatewayReachable: await probeLocalOttoGateway(),
          }),
        });
        pi.sendMessage(
          { customType: "otto-langflow-build", content: prompt, display: false },
          { triggerTurn: true },
        );
        return result("Started a LangFlow build turn for the requested flow.", { action: params.action });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const connectionFailure = connectionFailureResult(params.action, message);
    if (connectionFailure) return connectionFailure;
    throw err;
  }
}

export function makeLangFlowTool(pi: Pick<ExtensionAPI, "sendMessage">): ToolDefinition<typeof Params, LangFlowToolDetails> {
  return {
    name: "otto__langflow",
    label: "LangFlow",
    description:
      "Perform LangFlow control-plane actions from natural language: status, list/show/import/export/delete/run flows, or start a flow build. " +
      "Use this for user requests about LangFlow flows instead of asking for slash command syntax.",
    promptSnippet: "Manage LangFlow flows: build, list, show, import, export, delete, run, and status.",
    promptGuidelines: [
      "Use otto__langflow for natural-language LangFlow requests.",
      "If otto__langflow reports that LangFlow is not connected or authentication is missing, do not retry; tell the user to run /otto langflow connect.",
      "For delete_flow, set confirmDelete true only when the user explicitly asks to delete/remove a flow.",
      "For import_flow over an existing flow, use update, replace, or createNew only when the user requested that behavior.",
      "For build_flow, pass the user's full flow description.",
    ],
    parameters: Params,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        return await executeLangFlowTool(params, ctx.cwd, pi);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return result(`LangFlow action failed: ${message}`, { action: params.action }, true);
      }
    },
  };
}
