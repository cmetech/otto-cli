/**
 * /otto build-flow <description>
 *
 * Drives an agent turn that generates a LangFlow flow from natural language.
 * The agent gets:
 *   - Four reference docs as system context (workflow + 3 rule docs)
 *   - Seven typed tools (registered globally; see tools/_loader.ts) for
 *     catalog inspection, validation, import, smoke testing
 *   - Repo scaffolding (flows/{generated,templates,imported}, catalog/)
 *     so the agent has somewhere to write the result
 *
 * The handler does NOT run the LLM itself — it primes a fresh session and
 * dispatches via pi.sendMessage({triggerTurn:true}), the same seam
 * auto-direct-dispatch.ts uses.
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@otto/pi-coding-agent";
import { ensureRepoConventions } from "./_scaffold.js";
import { loadReferenceDocs } from "./_system-context.js";

const USAGE = `Usage: /otto build-flow <natural-language description of the flow>

Example:
  /otto build-flow "summarize a chunk of text using ollama"

The agent will inspect the LangFlow component catalog, design a flow,
validate the JSON, and write it under flows/generated/. Imports and
smoke tests only run when you explicitly ask.`;

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

      // Compose the prompt: reference docs + repo conventions reminder + user task.
      const prompt = [
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
        "  - Save generated flows under flows/generated/<slug>.json",
        "  - The component catalog lives in catalog/ (raw + normalized + index.md)",
        "  - Never put real secrets in flow JSON — use ${ENV_VAR} placeholders",
        "",
        "═══════════════════════════════════════════════════════════════════",
        "REFERENCE MATERIAL (read carefully before generating any JSON):",
        "═══════════════════════════════════════════════════════════════════",
        "",
        referenceContext,
        "",
        "═══════════════════════════════════════════════════════════════════",
        "USER REQUEST:",
        "═══════════════════════════════════════════════════════════════════",
        "",
        description,
      ].join("\n");

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
