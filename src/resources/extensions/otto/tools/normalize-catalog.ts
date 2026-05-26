/**
 * otto__normalize_catalog tool.
 *
 * Wraps the bundled normalize_component_catalog.py script. Converts the raw
 * catalog/components.raw.json into a searchable catalog/components.normalized.json
 * plus a markdown index in the workspace.
 *
 * Tool takes no arguments. Run after otto__refresh_catalog.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@otto/pi-coding-agent";
import { runPython } from "./python-runtime.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_here, "scripts", "normalize_component_catalog.py");

interface NormalizeCatalogDetails {
  exitCode: number;
  stdoutChars: number;
  stderrChars: number;
}

export const normalizeCatalogTool: ToolDefinition<ReturnType<typeof Type.Object>, NormalizeCatalogDetails> = {
  name: "otto__normalize_catalog",
  label: "Normalize LangFlow component catalog",
  description:
    "Normalize catalog/components.raw.json into a searchable catalog/components.normalized.json " +
    "plus a markdown index. Run after otto__refresh_catalog. No arguments.",
  parameters: Type.Object({}),
  async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
    const r = await runPython(SCRIPT, [], { cwd: ctx.cwd });
    const ok = r.exitCode === 0;
    const text = ok
      ? `Catalog normalized.\n\n${r.stdout}`
      : `Catalog normalization failed (exit ${r.exitCode}).\n\nSTDOUT:\n${r.stdout}\n\nSTDERR:\n${r.stderr}`;
    const details: NormalizeCatalogDetails = {
      exitCode: r.exitCode,
      stdoutChars: r.stdout.length,
      stderrChars: r.stderr.length,
    };
    return ok
      ? { content: [{ type: "text", text }], details }
      : { content: [{ type: "text", text }], isError: true, details };
  },
};
