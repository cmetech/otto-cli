/**
 * otto__check_catalog_health tool.
 *
 * Wraps the bundled check_catalog_health.py script. Reports coverage of
 * common LangFlow component categories so the agent can diagnose whether
 * the local catalog has what a planned flow needs.
 *
 * Tool takes no arguments.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@otto/pi-coding-agent";
import { runPython } from "./python-runtime.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_here, "scripts", "check_catalog_health.py");

interface CheckCatalogHealthDetails {
  exitCode: number;
  stdoutChars: number;
  stderrChars: number;
}

export const checkCatalogHealthTool: ToolDefinition<ReturnType<typeof Type.Object>, CheckCatalogHealthDetails> = {
  name: "otto__check_catalog_health",
  label: "Check LangFlow catalog health",
  description:
    "Report coverage of common LangFlow component categories (chat input, models, embeddings, " +
    "retrievers, vector stores, agents, tools, guardrails). Use to diagnose whether the local " +
    "catalog has what a planned flow needs.",
  parameters: Type.Object({}),
  async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
    const r = await runPython(SCRIPT, [], { cwd: ctx.cwd });
    const ok = r.exitCode === 0;
    const text = ok
      ? r.stdout
      : `Catalog health check failed (exit ${r.exitCode}).\n\nSTDOUT:\n${r.stdout}\n\nSTDERR:\n${r.stderr}`;
    const details: CheckCatalogHealthDetails = {
      exitCode: r.exitCode,
      stdoutChars: r.stdout.length,
      stderrChars: r.stderr.length,
    };
    return ok
      ? { content: [{ type: "text", text }], details }
      : { content: [{ type: "text", text }], isError: true, details };
  },
};
