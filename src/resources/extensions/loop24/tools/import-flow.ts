/**
 * loop24__import_flow tool.
 *
 * Wraps the bundled import_flow.py script. Uploads a validated flow JSON
 * file to the running LangFlow server. Only invoke when the user explicitly
 * asks to import. Requires LangFlow to be reachable.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@gsd/pi-coding-agent";
import { runPython } from "./python-runtime.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_here, "scripts", "import_flow.py");

interface ImportFlowDetails {
  exitCode: number;
  stdoutChars: number;
  stderrChars: number;
}

const Params = Type.Object({
  flowFile: Type.String({
    description: "Path to the flow JSON file to import into LangFlow.",
    minLength: 1,
  }),
});

export const importFlowTool: ToolDefinition<typeof Params, ImportFlowDetails> = {
  name: "loop24__import_flow",
  label: "Import flow into LangFlow",
  description:
    "Upload a validated flow JSON file to the running LangFlow server. Only invoke when the user " +
    "explicitly asks to import. Requires LangFlow reachable.",
  parameters: Params,
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const r = await runPython(SCRIPT, [params.flowFile], { cwd: ctx.cwd });
    const ok = r.exitCode === 0;
    const text = ok
      ? `Flow imported.\n\n${r.stdout}`
      : `Flow import failed (exit ${r.exitCode}).\n\nSTDOUT:\n${r.stdout}\n\nSTDERR:\n${r.stderr}`;
    const details: ImportFlowDetails = {
      exitCode: r.exitCode,
      stdoutChars: r.stdout.length,
      stderrChars: r.stderr.length,
    };
    return ok
      ? { content: [{ type: "text", text }], details }
      : { content: [{ type: "text", text }], isError: true, details };
  },
};
