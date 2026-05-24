/**
 * loop24__smoke_test_flow tool.
 *
 * Wraps the bundled smoke_test_flow.py script. Runs a flow against a test
 * message and returns the response. Only invoke when the user explicitly
 * asks to test a flow.
 *
 * Uses a 3-minute timeout since flow execution on the LangFlow server can
 * take significant time depending on the model and pipeline depth.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@gsd/pi-coding-agent";
import { runPython } from "./python-runtime.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_here, "scripts", "smoke_test_flow.py");

interface SmokeTestFlowDetails {
  exitCode: number;
  stdoutChars: number;
  stderrChars: number;
}

const Params = Type.Object({
  flowId: Type.String({
    description: "Flow id or endpoint name on the LangFlow server.",
    minLength: 1,
  }),
  message: Type.String({
    description: "Test input message to send through the flow.",
    minLength: 1,
  }),
});

export const smokeTestFlowTool: ToolDefinition<typeof Params, SmokeTestFlowDetails> = {
  name: "loop24__smoke_test_flow",
  label: "Smoke test LangFlow flow",
  description:
    "Run a flow against a test message and return the response. Only invoke when the user explicitly " +
    "asks to test a flow.",
  parameters: Params,
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const r = await runPython(SCRIPT, [params.flowId, params.message], { cwd: ctx.cwd, timeoutMs: 180_000 });
    const ok = r.exitCode === 0;
    const text = ok
      ? `Smoke test response:\n\n${r.stdout}`
      : `Smoke test failed (exit ${r.exitCode}).\n\nSTDOUT:\n${r.stdout}\n\nSTDERR:\n${r.stderr}`;
    const details: SmokeTestFlowDetails = {
      exitCode: r.exitCode,
      stdoutChars: r.stdout.length,
      stderrChars: r.stderr.length,
    };
    return ok
      ? { content: [{ type: "text", text }], details }
      : { content: [{ type: "text", text }], isError: true, details };
  },
};
