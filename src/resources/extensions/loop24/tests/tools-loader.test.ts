import { test } from "node:test";
import assert from "node:assert/strict";
import { registerLoop24Tools, LOOP24_TOOL_NAMES } from "../tools/_loader.js";

test("LOOP24_TOOL_NAMES enumerates all seven flow-builder tools", () => {
  assert.deepEqual([...LOOP24_TOOL_NAMES].sort(), [
    "loop24__check_catalog_health",
    "loop24__import_flow",
    "loop24__inspect_component",
    "loop24__normalize_catalog",
    "loop24__refresh_catalog",
    "loop24__smoke_test_flow",
    "loop24__validate_flow",
  ]);
});

test("registerLoop24Tools calls pi.registerTool seven times with the right names", () => {
  const registered: string[] = [];
  const fakePi = {
    registerTool: (tool: { name: string }) => { registered.push(tool.name); },
  };
  registerLoop24Tools(fakePi as unknown as Parameters<typeof registerLoop24Tools>[0]);
  assert.deepEqual(registered.sort(), [...LOOP24_TOOL_NAMES].sort());
});
