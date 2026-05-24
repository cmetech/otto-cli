/**
 * loop24__inspect_component tool.
 *
 * Wraps the bundled inspect_component.py script. Searches the normalized
 * component catalog and dumps fields/outputs/types for matching components.
 *
 * Exit code 2 from the script means no matches — surfaced as a non-error
 * response. Any other non-zero exit code is treated as a real error.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@loop24/pi-coding-agent";
import { runPython } from "./python-runtime.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_here, "scripts", "inspect_component.py");

interface InspectComponentDetails {
  exitCode: number;
  stdoutChars: number;
  stderrChars: number;
}

const Params = Type.Object({
  searchTerm: Type.String({
    description:
      "Substring to match against component type, display name, category, fields, outputs (case-insensitive). e.g. 'chat', 'openai', 'qdrant'.",
    minLength: 1,
  }),
});

export const inspectComponentTool: ToolDefinition<typeof Params, InspectComponentDetails> = {
  name: "loop24__inspect_component",
  label: "Inspect LangFlow component",
  description:
    "Search the normalized component catalog and dump fields/outputs/types for matching components. " +
    "Use to discover exact field names and edge handle types before writing flow JSON.",
  parameters: Params,
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const r = await runPython(SCRIPT, [params.searchTerm], { cwd: ctx.cwd });
    const details: InspectComponentDetails = {
      exitCode: r.exitCode,
      stdoutChars: r.stdout.length,
      stderrChars: r.stderr.length,
    };
    // Exit 2 means no matches — not an error, just an informational response.
    if (r.exitCode === 2) {
      const text = `No matches for "${params.searchTerm}".`;
      return { content: [{ type: "text", text }], details };
    }
    const ok = r.exitCode === 0;
    const text = ok
      ? r.stdout
      : `Inspect failed (exit ${r.exitCode}).\n\nSTDOUT:\n${r.stdout}\n\nSTDERR:\n${r.stderr}`;
    return ok
      ? { content: [{ type: "text", text }], details }
      : { content: [{ type: "text", text }], isError: true, details };
  },
};
