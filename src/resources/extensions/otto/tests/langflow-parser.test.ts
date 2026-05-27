import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLangFlowCommand, splitFirstArg } from "../commands/langflow/parser.js";

test("parseLangFlowCommand defaults to status", () => {
  assert.deepEqual(parseLangFlowCommand(""), { action: "status", rest: "" });
});

test("parseLangFlowCommand separates action and rest", () => {
  assert.deepEqual(parseLangFlowCommand("run Echo hello world"), { action: "run", rest: "Echo hello world" });
});

test("splitFirstArg supports quoted flow names", () => {
  assert.deepEqual(splitFirstArg('"Echo Flow" hello world'), { first: "Echo Flow", rest: "hello world" });
});
