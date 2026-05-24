/**
 * loop24__refresh_catalog tool.
 *
 * Wraps the bundled refresh_component_catalog.py script. Pulls the current
 * LangFlow component catalog from a running LangFlow server and writes it
 * to catalog/components.raw.json in the workspace.
 *
 * Tool takes no arguments — the script reads LANGFLOW_SERVER_URL and
 * LANGFLOW_API_KEY from the environment, which loop24-config.ts has
 * already populated from ~/.loop24/config.json.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@gsd/pi-coding-agent";
import { runPython } from "./python-runtime.js";

const _here = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(_here, "scripts", "refresh_component_catalog.py");

interface RefreshCatalogDetails {
  exitCode: number;
  stdoutChars: number;
  stderrChars: number;
}

export const refreshCatalogTool: ToolDefinition<ReturnType<typeof Type.Object>, RefreshCatalogDetails> = {
  name: "loop24__refresh_catalog",
  label: "Refresh LangFlow component catalog",
  description:
    "Pull the current LangFlow component catalog from the running LangFlow server " +
    "and cache it locally at catalog/components.raw.json. Run this before generating " +
    "any new flow when the catalog is missing or stale. Requires LangFlow to be reachable.",
  parameters: Type.Object({}),
  async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
    const r = await runPython(SCRIPT, [], { cwd: ctx.cwd });
    const ok = r.exitCode === 0;
    const text = ok
      ? `Catalog refreshed.\n\n${r.stdout}`
      : `Catalog refresh failed (exit ${r.exitCode}).\n\nSTDOUT:\n${r.stdout}\n\nSTDERR:\n${r.stderr}`;
    const details: RefreshCatalogDetails = {
      exitCode: r.exitCode,
      stdoutChars: r.stdout.length,
      stderrChars: r.stderr.length,
    };
    return ok
      ? { content: [{ type: "text", text }], details }
      : { content: [{ type: "text", text }], isError: true, details };
  },
};
