/**
 * loop24__validate_flow tool.
 *
 * Wraps the bundled validate_flow.sh bash script. Always checks JSON syntax;
 * if the lfx CLI is installed, also runs LangFlow schema validation. The
 * script may write lfx-missing warnings to stderr even on success — those
 * are surfaced in the Notes section of the success text.
 *
 * Uses runBash (not runPython) since the wrapper is a shell script.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@loop24/pi-coding-agent";
import { runBash } from "./python-runtime.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_here, "scripts", "validate_flow.sh");

interface ValidateFlowDetails {
  exitCode: number;
  stdoutChars: number;
  stderrChars: number;
}

const Params = Type.Object({
  flowFile: Type.String({
    description:
      "Path to the flow JSON file to validate (typically flows/generated/<slug>.json). Relative to the workspace.",
    minLength: 1,
  }),
});

export const validateFlowTool: ToolDefinition<typeof Params, ValidateFlowDetails> = {
  name: "loop24__validate_flow",
  label: "Validate LangFlow flow JSON",
  description:
    "Validate a flow JSON file. Always checks JSON syntax; if the lfx CLI is installed, also runs " +
    "LangFlow schema validation. Run after writing any flow JSON.",
  parameters: Params,
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const r = await runBash(SCRIPT, [params.flowFile], { cwd: ctx.cwd });
    const ok = r.exitCode === 0;
    const text = ok
      ? `Validation OK.\n\n${r.stdout}${r.stderr ? "\n\nNotes:\n" + r.stderr : ""}`
      : `Validation failed (exit ${r.exitCode}).\n\nSTDOUT:\n${r.stdout}\n\nSTDERR:\n${r.stderr}`;
    const details: ValidateFlowDetails = {
      exitCode: r.exitCode,
      stdoutChars: r.stdout.length,
      stderrChars: r.stderr.length,
    };
    return ok
      ? { content: [{ type: "text", text }], details }
      : { content: [{ type: "text", text }], isError: true, details };
  },
};
