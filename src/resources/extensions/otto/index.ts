/**
 * OTTO Extension
 *
 * Owns:
 *   - Brand banner and theme files (under branding/ and theme/)
 *   - Connection probes for gateway + langflow at session_start
 *   - Declarative LangFlow flow-trigger slash commands loaded from
 *     commands/flow-triggers/*.yaml
 *   - LangFlow flow-builder tools + /otto build-flow command (Phase 4)
 *   - One-shot LLM polish: /otto prompt-engineer
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@otto/pi-coding-agent";
import { LangFlowClient } from "./clients/langflow.js";
import { loadFlowTriggers } from "./commands/flow-triggers/_loader.js";
import type { FlowTrigger, FlowTriggerInput } from "./commands/flow-triggers/_schema.js";
import { ANSI_BRAND_YELLOW, ANSI_BRAND_GREEN, ANSI_DIM, ANSI_RESET } from "../../brand-colors.js";
import { registerOttoTools } from "./tools/_loader.js";
import { registerBuildFlowCommand } from "./commands/build-flow/command.js";
import { registerPromptEngineerCommand } from "./commands/prompt-engineer/command.js";

const _here = dirname(fileURLToPath(import.meta.url));
const FLOW_TRIGGERS_DIR = join(_here, "commands", "flow-triggers");

const LANGFLOW_DEFAULT_URL = "http://127.0.0.1:7860";

function getLangFlowClient(): LangFlowClient {
  return new LangFlowClient({
    baseUrl: process.env.LANGFLOW_SERVER_URL || LANGFLOW_DEFAULT_URL,
    apiKey: process.env.LANGFLOW_API_KEY,
  });
}

/** Parse `--name value` style args from a single string. Minimal — caller handles edge cases. */
function parseArgs(argString: string, inputs: FlowTriggerInput[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const re = /--([a-zA-Z0-9_-]+)(?:=("[^"]*"|\S+)|\s+("[^"]*"|\S+))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(argString))) {
    const key = m[1] as string;
    let raw = (m[2] ?? m[3] ?? "true") as string;
    if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
    const inputDef = inputs.find((i) => i.name === key);
    if (!inputDef) { out[key] = raw; continue; }
    switch (inputDef.type) {
      case "number": out[key] = Number(raw); break;
      case "bool":   out[key] = raw === "true"; break;
      default:       out[key] = raw;
    }
  }
  // Apply defaults for any missing inputs that declared one.
  for (const inp of inputs) {
    if (out[inp.name] === undefined && inp.default !== undefined) out[inp.name] = inp.default;
  }
  return out;
}

function buildHandler(trigger: FlowTrigger): (args: string, ctx: ExtensionCommandContext) => Promise<void> {
  return async (args: string, _ctx: ExtensionCommandContext) => {
    const client = new LangFlowClient({
      baseUrl: trigger.server || process.env.LANGFLOW_SERVER_URL || LANGFLOW_DEFAULT_URL,
      apiKey: process.env.LANGFLOW_API_KEY,
      timeoutMs: trigger.execution?.timeoutMs,
    });

    const parsed = parseArgs(args, trigger.inputs);

    // Validate required inputs are present
    const missing = trigger.inputs.filter((i) => i.required && parsed[i.name] === undefined).map((i) => i.name);
    if (missing.length > 0) {
      process.stderr.write(`Missing required argument(s): ${missing.join(", ")}\n`);
      return;
    }

    // Map argName → flowField
    const flowInputs: Record<string, unknown> = {};
    for (const inp of trigger.inputs) {
      if (parsed[inp.name] !== undefined) flowInputs[inp.flowField] = parsed[inp.name];
    }
    const inputValue = String(flowInputs.input_value ?? Object.values(flowInputs)[0] ?? "");

    try {
      const flowId = trigger.flow.id ?? trigger.flow.name;
      if (!flowId) {
        process.stderr.write(`langflow: trigger has neither flow.id nor flow.name\n`);
        return;
      }
      const result = await client.runFlow(flowId, { input_value: inputValue, ...flowInputs });
      process.stdout.write(result.text + "\n");
    } catch (err) {
      process.stderr.write(`langflow error: ${(err as Error).message}\n`);
    }
  };
}

export default function Otto(pi: ExtensionAPI): void {
  pi.on("session_start", async () => {
    const yellow = ANSI_BRAND_YELLOW;
    const green  = ANSI_BRAND_GREEN;
    const dim    = ANSI_DIM;
    const reset  = ANSI_RESET;

    // ── Gateway connection probe (preserved from Phase 1 Task 6) ──
    const gwUrl = process.env.OTTO_GATEWAY_URL?.trim();
    if (gwUrl) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 1500);
        const r = await fetch(`${gwUrl.replace(/\/$/, "")}/health`, { signal: ctl.signal });
        clearTimeout(timer);
        const ok = r.ok;
        const host = new URL(gwUrl).host;
        process.stderr.write(`  ${yellow}gateway:${reset} ${ok ? green : dim}routed → ${host}${reset}\n`);
      } catch {
        const host = new URL(gwUrl).host;
        process.stderr.write(`  ${yellow}gateway:${reset} ${dim}routed → ${host} (unreachable)${reset}\n`);
      }
    } else {
      process.stderr.write(`  ${yellow}gateway:${reset} ${dim}direct (no OTTO_GATEWAY_URL set)${reset}\n`);
    }

    // ── LangFlow connection probe (Phase 3) ──
    const lfClient = getLangFlowClient();
    const lfUrl = process.env.LANGFLOW_SERVER_URL || LANGFLOW_DEFAULT_URL;
    const lfVersion = await lfClient.getVersion();
    const lfHost = new URL(lfUrl).host;
    if (lfVersion) {
      process.stderr.write(`  ${yellow}langflow:${reset} ${green}connected${reset} ${dim}(v${lfVersion.version} @ ${lfHost})${reset}\n`);
    } else {
      process.stderr.write(`  ${yellow}langflow:${reset} ${dim}offline (${lfHost})${reset}\n`);
    }
  });

  // ── Register flow-builder tools (Phase 4) ──
  registerOttoTools(pi);

  // ── Register /otto build-flow slash command (Phase 4) ──
  registerBuildFlowCommand(pi);

  // ── Register /otto prompt-engineer slash command (Phase 5) ──
  registerPromptEngineerCommand(pi);

  // ── Load and register flow-trigger slash commands ──
  // Fire-and-forget. Pi's command registry is dynamic; late registrations work.
  loadFlowTriggers(FLOW_TRIGGERS_DIR)
    .then(({ commands, errors }) => {
      for (const t of commands) {
        pi.registerCommand(t.name, {
          description: t.description,
          handler: buildHandler(t),
        });
      }
      if (errors.length > 0) {
        for (const e of errors) {
          process.stderr.write(`[otto] flow-trigger ${e.file}: ${e.message}\n`);
        }
      }
    })
    .catch((err) => {
      process.stderr.write(`[otto] flow-trigger loader failed: ${(err as Error).message}\n`);
    });
}
