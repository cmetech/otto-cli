/**
 * /otto build-flow <description>
 *
 * Drives an agent turn that generates a LangFlow flow from natural language.
 * The agent gets:
 *   - Four reference docs as system context (workflow + 3 rule docs)
 *   - Seven typed tools (registered globally; see tools/_loader.ts) for
 *     catalog inspection, validation, import, smoke testing
 *   - Repo scaffolding (.otto/langflow/{generated,samples,imported,catalog,runs})
 *     so the agent has somewhere to write the result
 *
 * The handler does NOT run the LLM itself — it primes a fresh session and
 * dispatches via pi.sendMessage({triggerTurn:true}), the same seam
 * auto-direct-dispatch.ts uses.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@otto/pi-coding-agent";
import { ensureRepoConventions } from "./_scaffold.js";
import { loadReferenceDocs } from "./_system-context.js";

const DEFAULT_OTTO_GATEWAY_URL = "http://127.0.0.1:18080";
const DEFAULT_OTTO_GATEWAY_MODEL = "claude-sonnet-4";

const USAGE = `Usage: /otto build-flow <natural-language description of the flow>

Example:
  /otto build-flow "summarize a chunk of text using ollama"

The agent will inspect the LangFlow component catalog, design a flow,
validate the JSON, and write it under .otto/langflow/generated/. Imports and
smoke tests only run when you explicitly ask.`;

export interface BuildFlowRuntimeDefaultsInput {
  env?: Partial<Record<"OTTO_GATEWAY_URL" | "OTTO_GATEWAY_MODEL" | "OTTO_GATEWAY_TOKEN", string | undefined>>;
  localGatewayReachable?: boolean;
}

export interface BuildFlowRuntimeDefaults {
  gatewayAvailable: boolean;
  baseUrl: string;
  apiFamily: "anthropic-messages";
  requestPath: "/v1/messages";
  model: string;
  tokenPlaceholder: "${OTTO_GATEWAY_TOKEN}";
}

function normalizeUrl(url: string): string {
  let normalized = url.trim().replace(/\/+$/, "");
  if (normalized.endsWith("/v1")) normalized = normalized.slice(0, -3);
  return normalized.replace(/\/+$/, "");
}

export function buildFlowRuntimeDefaults(input: BuildFlowRuntimeDefaultsInput = {}): BuildFlowRuntimeDefaults {
  const env = input.env ?? process.env;
  const configuredUrl = env.OTTO_GATEWAY_URL?.trim();
  const gatewayAvailable = Boolean(configuredUrl || input.localGatewayReachable);
  const baseUrl = normalizeUrl(configuredUrl || DEFAULT_OTTO_GATEWAY_URL);
  return {
    gatewayAvailable,
    baseUrl,
    apiFamily: "anthropic-messages",
    requestPath: "/v1/messages",
    model: env.OTTO_GATEWAY_MODEL?.trim() || DEFAULT_OTTO_GATEWAY_MODEL,
    tokenPlaceholder: "${OTTO_GATEWAY_TOKEN}",
  };
}

export async function probeLocalOttoGateway(timeoutMs = 500): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${DEFAULT_OTTO_GATEWAY_URL}/health`, { signal: ctl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function formatRuntimeDefaults(defaults: BuildFlowRuntimeDefaults): string {
  if (!defaults.gatewayAvailable) {
    return [
      "OTTO GATEWAY DEFAULTS:",
      "  - No configured or reachable local OTTO gateway was detected.",
      "  - If the user asks for an LLM-backed flow, inspect the local catalog and use safe environment-variable placeholders for credentials.",
      "  - Do not assume OpenAI or Ollama unless the requested runtime and catalog support that API shape.",
    ].join("\n");
  }

  return [
    "OTTO GATEWAY DEFAULTS:",
    "  - A local/configured OTTO gateway is available. Default LLM-backed flows to this gateway unless the user explicitly asks otherwise.",
    `  - Prefer an Anthropic-compatible LangFlow component using API family: ${defaults.apiFamily}.`,
    `  - Gateway base URL: ${defaults.baseUrl}`,
    `  - Final request path should be: ${defaults.requestPath}`,
    `  - Model default: ${defaults.model}`,
    `  - Credential placeholder: ${defaults.tokenPlaceholder}`,
    "  - Do NOT use Ollama for OTTO gateway flows.",
    "  - Do NOT use OpenAI-compatible components unless the catalog and gateway prove /v1/chat/completions is the correct shape.",
    "  - If no catalog component can call Anthropic Messages with a custom base URL, propose or generate a catalog-valid custom/Python component rather than faking OpenAI/Ollama wiring.",
  ].join("\n");
}

function flowComplianceChecklist(): string {
  return [
    "FLOW COMPLIANCE CHECKLIST:",
    "  - The graph must have one clear valid user-entry path, usually Chat Input.",
    "  - The graph must have at least one terminal output path, usually Chat Output.",
    "  - Chat Output must be connected to the final response-producing component.",
    "  - Do not leave required components disconnected.",
    "  - Every edge must use source/target handles confirmed by the catalog, a known-good exported flow, or validation feedback.",
    "  - For Chat Input, connect the `message` output from the ChatInput node to a compatible downstream `input_value`/message field.",
    "  - For Chat Output, connect the final response component's Message-producing output (often `text_output` or `message`) to ChatOutput `input_value`.",
    "  - ChatOutput `input_value` is usually a HandleInput with target handle `type: other`; do not emit `type: str` unless the imported/exported component metadata says so.",
    "  - Validate with otto__validate_flow after writing JSON, then repair any source/target/handle mismatch before declaring the flow complete.",
    "  - If LangFlow says connections were removed after import, inspect the removed edge and regenerate only that edge from component output/input metadata.",
    "  - For external calls such as model/gateway calls, include failure handling when catalog components support it.",
    "  - If catalog-valid failure handling cannot be represented, state that limitation in notes instead of inventing unavailable router/error components.",
  ].join("\n");
}

export function composeBuildFlowPrompt(options: {
  description: string;
  referenceContext: string;
  runtimeDefaults: BuildFlowRuntimeDefaults;
}): string {
  return [
    "You are building a LangFlow flow JSON file from a natural-language description.",
    "Follow the rules in the reference material below verbatim.",
    "",
    "AVAILABLE TOOLS (use them — do NOT invent component names):",
    "  - otto__refresh_catalog        (pull current LangFlow catalog)",
    "  - otto__normalize_catalog      (normalize into searchable form)",
    "  - otto__check_catalog_health   (diagnose missing categories)",
    "  - otto__inspect_component      (look up fields/outputs for a component)",
    "  - otto__validate_flow          (validate flow JSON before declaring success)",
    "  - otto__import_flow            (ONLY on explicit user request)",
    "  - otto__smoke_test_flow        (ONLY on explicit user request)",
    "",
    "REPO CONVENTIONS:",
    "  - Save generated flows under .otto/langflow/generated/<slug>.json",
    "  - The component catalog lives in .otto/langflow/catalog/ (raw + normalized + index.md)",
    "  - Never put real secrets in flow JSON — use ${ENV_VAR} placeholders",
    "",
    formatRuntimeDefaults(options.runtimeDefaults),
    "",
    flowComplianceChecklist(),
    "",
    "═══════════════════════════════════════════════════════════════════",
    "REFERENCE MATERIAL (read carefully before generating any JSON):",
    "═══════════════════════════════════════════════════════════════════",
    "",
    options.referenceContext,
    "",
    "═══════════════════════════════════════════════════════════════════",
    "USER REQUEST:",
    "═══════════════════════════════════════════════════════════════════",
    "",
    options.description,
  ].join("\n");
}

export function registerBuildFlowCommand(pi: ExtensionAPI): void {
  pi.registerCommand("build-flow", {
    description: "Generate a LangFlow flow JSON from a natural-language description",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const description = args.trim();
      if (!description) {
        process.stderr.write(USAGE + "\n");
        return;
      }

      // Ensure repo conventions before anything else.
      try {
        const result = await ensureRepoConventions(ctx.cwd);
        if (result.created.length > 0 || result.gitignoreUpdated) {
          const bits: string[] = [];
          if (result.created.length > 0) bits.push(`created ${result.created.join(", ")}`);
          if (result.gitignoreUpdated) bits.push("updated .gitignore");
          process.stderr.write(`[otto build-flow] ${bits.join("; ")}\n`);
        }
      } catch (err) {
        process.stderr.write(`[otto build-flow] scaffold failed: ${(err as Error).message}\n`);
        return;
      }

      // Load reference docs as system context.
      let referenceContext: string;
      try {
        referenceContext = await loadReferenceDocs();
      } catch (err) {
        process.stderr.write(`[otto build-flow] could not load reference docs: ${(err as Error).message}\n`);
        return;
      }

      const prompt = composeBuildFlowPrompt({
        description,
        referenceContext,
        runtimeDefaults: buildFlowRuntimeDefaults({
          localGatewayReachable: await probeLocalOttoGateway(),
        }),
      });

      // Fresh session for the build-flow task, then dispatch.
      const sessionResult = await ctx.newSession({ workspaceRoot: ctx.cwd });
      if (sessionResult.cancelled) {
        process.stderr.write(`[otto build-flow] session creation cancelled\n`);
        return;
      }
      pi.sendMessage(
        { customType: "otto-build-flow", content: prompt, display: false },
        { triggerTurn: true },
      );
    },
  });
}
