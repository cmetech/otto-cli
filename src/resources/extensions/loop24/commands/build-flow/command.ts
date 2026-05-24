/**
 * /loop24 build-flow <description>
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

import type { ExtensionAPI, ExtensionCommandContext } from "@gsd/pi-coding-agent";
import { ensureRepoConventions } from "./_scaffold.js";
import { loadReferenceDocs } from "./_system-context.js";

const USAGE = `Usage: /loop24 build-flow <natural-language description of the flow>

Example:
  /loop24 build-flow "summarize a chunk of text using ollama"

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
          process.stderr.write(`[loop24 build-flow] ${bits.join("; ")}\n`);
        }
      } catch (err) {
        process.stderr.write(`[loop24 build-flow] scaffold failed: ${(err as Error).message}\n`);
        return;
      }

      // Load reference docs as system context.
      let referenceContext: string;
      try {
        referenceContext = await loadReferenceDocs();
      } catch (err) {
        process.stderr.write(`[loop24 build-flow] could not load reference docs: ${(err as Error).message}\n`);
        return;
      }

      // Compose the prompt: reference docs + repo conventions reminder + user task.
      const prompt = [
        "You are building a LangFlow flow JSON file from a natural-language description.",
        "Follow the rules in the reference material below verbatim.",
        "",
        "AVAILABLE TOOLS (use them — do NOT invent component names):",
        "  - loop24__refresh_catalog        (pull current LangFlow catalog)",
        "  - loop24__normalize_catalog      (normalize into searchable form)",
        "  - loop24__check_catalog_health   (diagnose missing categories)",
        "  - loop24__inspect_component      (look up fields/outputs for a component)",
        "  - loop24__validate_flow          (validate flow JSON before declaring success)",
        "  - loop24__import_flow            (ONLY on explicit user request)",
        "  - loop24__smoke_test_flow        (ONLY on explicit user request)",
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
        process.stderr.write(`[loop24 build-flow] session creation cancelled\n`);
        return;
      }
      pi.sendMessage(
        { customType: "loop24-build-flow", content: prompt, display: false },
        { triggerTurn: true },
      );
    },
  });
}
