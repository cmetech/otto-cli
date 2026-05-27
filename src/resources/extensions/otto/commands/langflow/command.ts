import type { ExtensionAPI, ExtensionCommandContext } from "@otto/pi-coding-agent";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { LangFlowClient, type LangFlowSummary } from "../../clients/langflow.js";
import { resolveLangFlowArtifacts } from "../../langflow/artifacts.js";
import {
  buildFlowRuntimeDefaults,
  composeBuildFlowPrompt,
  probeLocalOttoGateway,
} from "../build-flow/command.js";
import { ensureRepoConventions } from "../build-flow/_scaffold.js";
import { loadReferenceDocs } from "../build-flow/_system-context.js";
import {
  effectiveLangFlowConfig,
  loadLangFlowConfig,
  saveLangFlowConfig,
  type LangFlowConfig,
} from "../../langflow/config.js";
import { parseLangFlowCommand, splitFirstArg } from "./parser.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = resolve(_here, "..", "..", "samples", "langflow");

const USAGE = [
  "Usage: /otto langflow <command>",
  "",
  "Commands:",
  "  status                         Show configured URL and server health",
  "  connect [url]                  Enable LangFlow and save URL to ~/.otto/config.json",
  "  disconnect                     Disable LangFlow without deleting URL or API key",
  "  flows                          List flows from the server",
  "  show <flow-id-or-name>         Show full server flow JSON",
  "  samples                        Copy bundled sample flows to .otto/langflow/samples",
  "  import <file|sample-name>      Import a flow JSON; refuses duplicates unless --update, --replace, or --new",
  "  delete <flow-id-or-name> --yes Delete a flow from the server",
  "  export <flow-id-or-name>       Export server flow JSON to .otto/langflow/exported",
  "  run <flow-id-or-name> <input>  Execute a flow with input text",
  "  build <description>            Start a builder turn for a generated flow JSON",
].join("\n");

function notify(ctx: ExtensionCommandContext, message: string, type: "info" | "warning" | "error" | "success" = "info"): void {
  ctx.ui.notify(message, type);
}

function emit(pi: ExtensionAPI, ctx: ExtensionCommandContext, content: string): void {
  if (pi && typeof pi.sendMessage === "function") {
    pi.sendMessage({ customType: "otto-langflow", content, display: true });
    ctx.ui.notify(content.length > 1500 ? `${content.slice(0, 1500)}\n...` : content, "info");
    return;
  }
  notify(ctx, content, "info");
}

function makeClient(cfg: LangFlowConfig): LangFlowClient {
  return new LangFlowClient({
    baseUrl: cfg.url,
    apiKey: cfg.apiKey ?? undefined,
  });
}

function requireEnabled(ctx: ExtensionCommandContext, cfg: LangFlowConfig): boolean {
  if (cfg.enabled) return true;
  notify(ctx, "LangFlow is disabled. Run /otto langflow connect [url] to enable it.", "warning");
  return false;
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

function sampleFiles(): string[] {
  if (!existsSync(SAMPLE_DIR)) return [];
  return readdirSync(SAMPLE_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function copySamples(projectRoot: string): string[] {
  const paths = ensureArtifactDirs(projectRoot);
  const copied: string[] = [];
  for (const name of sampleFiles()) {
    copyFileSync(join(SAMPLE_DIR, name), join(paths.samples, name));
    copied.push(name);
  }
  return copied;
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf-8")) as unknown;
}

function resolveFlowJson(projectRoot: string, arg: string): { path: string; payload: unknown } {
  const paths = ensureArtifactDirs(projectRoot);
  const candidates = [
    resolve(projectRoot, arg),
    resolve(paths.samples, arg),
    resolve(paths.samples, arg.endsWith(".json") ? arg : `${arg}.json`),
    resolve(SAMPLE_DIR, arg),
    resolve(SAMPLE_DIR, arg.endsWith(".json") ? arg : `${arg}.json`),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) throw new Error(`Flow JSON not found: ${arg}. Run /otto langflow samples or pass a file path.`);
  return { path: found, payload: readJsonFile(found) };
}

function resolveFlowId(input: string, flows: LangFlowSummary[]): string {
  const lowered = input.toLowerCase();
  const match = flows.find((flow) =>
    flow.id === input ||
    flow.name.toLowerCase() === lowered ||
    flow.endpointName?.toLowerCase() === lowered
  );
  return match?.id ?? input;
}

function findFlow(input: string, flows: LangFlowSummary[]): LangFlowSummary | undefined {
  const lowered = input.toLowerCase();
  return flows.find((flow) =>
    flow.id === input ||
    flow.name.toLowerCase() === lowered ||
    flow.endpointName?.toLowerCase() === lowered
  );
}

async function resolveExistingFlow(client: LangFlowClient, input: string): Promise<LangFlowSummary | undefined> {
  return findFlow(input, await client.listFlows());
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

function stripFlags(rest: string): { value: string; flags: Set<string> } {
  const parts = rest.split(/\s+/).filter(Boolean);
  const flags = new Set(parts.filter((part) => part.startsWith("--")));
  const value = parts.filter((part) => !part.startsWith("--")).join(" ");
  return { value, flags };
}

function writeRunRecord(projectRoot: string, flow: string, input: string, text: string, raw: unknown): string {
  const paths = ensureArtifactDirs(projectRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(paths.runs, `${stamp}.json`);
  writeFileSync(path, JSON.stringify({ at: new Date().toISOString(), flow, input, text, raw }, null, 2) + "\n");
  return path;
}

async function handleStatus(ctx: ExtensionCommandContext): Promise<void> {
  const cfg = effectiveLangFlowConfig();
  if (!cfg.enabled) {
    ctx.ui.setStatus("otto-langflow", undefined);
    notify(ctx, `LangFlow disabled (${cfg.url}). Run /otto langflow connect to enable.`, "info");
    return;
  }
  const version = await makeClient(cfg).getVersion(1500);
  if (version) {
    ctx.ui.setStatus("otto-langflow", `LangFlow ok v${version.version}`);
    notify(ctx, `LangFlow connected at ${cfg.url} (v${version.version}).`, "success");
  } else {
    ctx.ui.setStatus("otto-langflow", "LangFlow offline");
    notify(ctx, `LangFlow configured at ${cfg.url}, but health check failed.`, "warning");
  }
}

async function handleConnect(rest: string, ctx: ExtensionCommandContext): Promise<void> {
  const cfg = loadLangFlowConfig();
  const url = rest.trim() || process.env.LANGFLOW_SERVER_URL?.trim() || cfg.url;
  const next: LangFlowConfig = {
    url,
    apiKey: process.env.LANGFLOW_API_KEY?.trim() || cfg.apiKey,
    enabled: true,
  };
  saveLangFlowConfig(next);
  process.env.LANGFLOW_SERVER_URL = url;
  if (next.apiKey) process.env.LANGFLOW_API_KEY = next.apiKey;
  delete process.env.OTTO_LANGFLOW_DISABLED;
  await handleStatus(ctx);
}

function handleDisconnect(ctx: ExtensionCommandContext): void {
  const cfg = loadLangFlowConfig();
  saveLangFlowConfig({ ...cfg, enabled: false });
  process.env.OTTO_LANGFLOW_DISABLED = "1";
  ctx.ui.setStatus("otto-langflow", undefined);
  notify(ctx, "LangFlow disabled. Existing URL and API key were kept in ~/.otto/config.json.", "success");
}

async function handleFlows(ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
  const cfg = effectiveLangFlowConfig();
  if (!requireEnabled(ctx, cfg)) return;
  const flows = await makeClient(cfg).listFlows();
  if (flows.length === 0) {
    emit(pi, ctx, "No LangFlow flows returned by the server.");
    return;
  }
  emit(pi, ctx, flows.map((flow) => `- ${flow.name} (${flow.id})${flow.endpointName ? ` endpoint=${flow.endpointName}` : ""}`).join("\n"));
}

async function handleShow(rest: string, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
  const cfg = effectiveLangFlowConfig();
  if (!requireEnabled(ctx, cfg)) return;
  if (!rest) {
    emit(pi, ctx, [
      "Usage: /otto langflow show <flow-id-or-name>",
      "",
      "Run /otto langflow flows to list available flow ids and names.",
    ].join("\n"));
    return;
  }
  const client = makeClient(cfg);
  const flow = await resolveExistingFlow(client, rest) ?? { id: rest };
  emit(pi, ctx, JSON.stringify(await client.getFlow(flow.id), null, 2));
}

function handleSamples(projectRoot: string, ctx: ExtensionCommandContext, pi: ExtensionAPI): void {
  const copied = copySamples(projectRoot);
  emit(pi, ctx, copied.length > 0
    ? `Copied LangFlow sample flows to .otto/langflow/samples:\n${copied.map((name) => `- ${name}`).join("\n")}`
    : "No bundled LangFlow samples found.");
}

async function handleImport(rest: string, projectRoot: string, ctx: ExtensionCommandContext): Promise<void> {
  const cfg = effectiveLangFlowConfig();
  if (!requireEnabled(ctx, cfg)) return;
  if (!rest) {
    notify(ctx, "Usage: /otto langflow import <file|sample-name>", "warning");
    return;
  }
  const { first, rest: flagsText } = splitFirstArg(rest);
  const flags = new Set(flagsText.split(/\s+/).filter((part) => part.startsWith("--")));
  const paths = ensureArtifactDirs(projectRoot);
  const source = resolveFlowJson(projectRoot, first);
  const client = makeClient(cfg);
  const existing = findMatchingImportedFlow(source.payload, await client.listFlows());
  if (existing && !flags.has("--update") && !flags.has("--replace") && !flags.has("--new")) {
    notify(
      ctx,
      `LangFlow flow already exists: ${existing.name} (${existing.id}). Re-run with --update, --replace, or --new.`,
      "warning",
    );
    return;
  }
  let result: unknown;
  if (existing && flags.has("--update")) {
    result = await client.updateFlow(existing.id, source.payload);
    copyFileSync(source.path, join(paths.imported, basename(source.path)));
    notify(ctx, `Updated LangFlow flow ${existing.id} from ${basename(source.path)}.`, "success");
    return;
  }
  if (existing && flags.has("--replace")) {
    await client.deleteFlow(existing.id);
  }
  result = await client.importFlow(source.payload);
  copyFileSync(source.path, join(paths.imported, basename(source.path)));
  const id = typeof result === "object" && result && "id" in result ? String((result as { id: unknown }).id) : "unknown";
  notify(ctx, `Imported LangFlow flow ${id} from ${basename(source.path)}.`, "success");
}

async function handleDelete(rest: string, ctx: ExtensionCommandContext): Promise<void> {
  const cfg = effectiveLangFlowConfig();
  if (!requireEnabled(ctx, cfg)) return;
  const { value, flags } = stripFlags(rest);
  if (!value) {
    notify(ctx, "Usage: /otto langflow delete <flow-id-or-name> --yes", "warning");
    return;
  }
  if (!flags.has("--yes")) {
    notify(ctx, `Refusing to delete ${value} without --yes.`, "warning");
    return;
  }
  const client = makeClient(cfg);
  const flow = await resolveExistingFlow(client, value);
  const flowId = flow?.id ?? value;
  await client.deleteFlow(flowId);
  notify(ctx, `Deleted LangFlow flow ${flowId}.`, "success");
}

async function handleExport(rest: string, projectRoot: string, ctx: ExtensionCommandContext): Promise<void> {
  const cfg = effectiveLangFlowConfig();
  if (!requireEnabled(ctx, cfg)) return;
  const parts = rest.split(/\s+/).filter(Boolean);
  const flowArg = parts.find((part) => !part.startsWith("--"));
  if (!flowArg) {
    notify(ctx, "Usage: /otto langflow export <flow-id-or-name> [--out <file>] [--overwrite]", "warning");
    return;
  }
  const outIndex = parts.indexOf("--out");
  const outArg = outIndex >= 0 ? parts[outIndex + 1] : undefined;
  const overwrite = parts.includes("--overwrite");
  const paths = ensureArtifactDirs(projectRoot);
  const client = makeClient(cfg);
  const flow = await resolveExistingFlow(client, flowArg);
  const flowId = flow?.id ?? flowArg;
  const raw = await client.getFlow(flowId);
  const name = flow?.name ?? (flowIdentity(raw).name ?? flowId);
  const outPath = outArg ? resolve(projectRoot, outArg) : join(paths.exported, `${slugify(name)}.json`);
  if (existsSync(outPath) && !overwrite) {
    notify(ctx, `Refusing to overwrite existing file: ${outPath}. Re-run with --overwrite.`, "warning");
    return;
  }
  writeFileSync(outPath, JSON.stringify(raw, null, 2) + "\n");
  notify(ctx, `Exported LangFlow flow ${flowId} to ${outPath}.`, "success");
}

async function handleRun(rest: string, projectRoot: string, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
  const cfg = effectiveLangFlowConfig();
  if (!requireEnabled(ctx, cfg)) return;
  const { first, rest: input } = splitFirstArg(rest);
  if (!first || !input) {
    notify(ctx, "Usage: /otto langflow run <flow-id-or-name> <input text>", "warning");
    return;
  }
  const client = makeClient(cfg);
  let flowId = first;
  try {
    flowId = resolveFlowId(first, await client.listFlows());
  } catch {
    flowId = first;
  }
  const result = await client.runFlow(flowId, { input_value: input, input_type: "chat", output_type: "chat" });
  const record = writeRunRecord(projectRoot, flowId, input, result.text, result.raw);
  emit(pi, ctx, `${result.text}\n\nRun saved: ${record}`);
}

async function handleBuild(rest: string, projectRoot: string, ctx: ExtensionCommandContext, pi: ExtensionAPI): Promise<void> {
  if (!rest) {
    notify(ctx, "Usage: /otto langflow build <natural-language description>", "warning");
    return;
  }
  ensureArtifactDirs(projectRoot);
  try {
    await ensureRepoConventions(projectRoot);
  } catch {
    // Artifact dirs above are enough for this compatibility path.
  }
  const referenceContext = await loadReferenceDocs();
  const sessionResult = await ctx.newSession({ workspaceRoot: projectRoot });
  if (sessionResult.cancelled) {
    notify(ctx, "LangFlow builder session creation cancelled.", "warning");
    return;
  }
  pi.sendMessage(
    {
      customType: "otto-langflow-build",
      content: composeBuildFlowPrompt({
        description: rest,
        referenceContext,
        runtimeDefaults: buildFlowRuntimeDefaults({
          localGatewayReachable: await probeLocalOttoGateway(),
        }),
      }),
      display: false,
    },
    { triggerTurn: true },
  );
}

export async function handleLangFlowCommand(
  rawArgs: string,
  ctx: ExtensionCommandContext,
  pi: ExtensionAPI,
  projectRoot: string,
): Promise<void> {
  const { action, rest } = parseLangFlowCommand(rawArgs);
  try {
    switch (action) {
      case "help":
        emit(pi, ctx, USAGE);
        return;
      case "status":
        await handleStatus(ctx);
        return;
      case "connect":
        await handleConnect(rest, ctx);
        return;
      case "disconnect":
        handleDisconnect(ctx);
        return;
      case "flows":
      case "list":
        await handleFlows(ctx, pi);
        return;
      case "show":
        await handleShow(rest, ctx, pi);
        return;
      case "samples":
        handleSamples(projectRoot, ctx, pi);
        return;
      case "import":
        await handleImport(rest, projectRoot, ctx);
        return;
      case "delete":
      case "remove":
        await handleDelete(rest, ctx);
        return;
      case "export":
        await handleExport(rest, projectRoot, ctx);
        return;
      case "run":
        await handleRun(rest, projectRoot, ctx, pi);
        return;
      case "build":
        await handleBuild(rest, projectRoot, ctx, pi);
        return;
      default:
        notify(ctx, `Unknown LangFlow command: ${action}\n\n${USAGE}`, "warning");
        return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    notify(ctx, `LangFlow command failed: ${msg}`, "error");
  }
}
