import { test } from "node:test";
import assert from "node:assert/strict";
import { registerOttoTools, OTTO_TOOL_NAMES } from "../tools/_loader.js";

test("OTTO_TOOL_NAMES enumerates all seven flow-builder tools", () => {
  assert.deepEqual([...OTTO_TOOL_NAMES].sort(), [
    "otto__check_catalog_health",
    "otto__import_flow",
    "otto__inspect_component",
    "otto__normalize_catalog",
    "otto__refresh_catalog",
    "otto__smoke_test_flow",
    "otto__validate_flow",
  ]);
});

test("registerOttoTools calls pi.registerTool seven times with the right names", () => {
  const registered: string[] = [];
  const fakePi = {
    registerTool: (tool: { name: string }) => { registered.push(tool.name); },
  };
  registerOttoTools(fakePi as unknown as Parameters<typeof registerOttoTools>[0]);
  assert.deepEqual(registered.sort(), [...OTTO_TOOL_NAMES].sort());
});
