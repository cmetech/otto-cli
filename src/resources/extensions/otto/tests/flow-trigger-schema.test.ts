import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFlowTrigger, type FlowTrigger } from "../commands/flow-triggers/_schema.js";

test("validates minimal valid YAML object", () => {
  const result = validateFlowTrigger({
    name: "analyze-logs",
    description: "Analyze a log file",
    flow: { id: "flow-abc" },
    inputs: [{ name: "file", type: "string", required: true, flowField: "input_file" }],
  });
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.value.name, "analyze-logs");
    assert.equal(result.value.flow.id, "flow-abc");
  }
});

test("rejects missing name", () => {
  const result = validateFlowTrigger({
    description: "x",
    flow: { id: "flow-abc" },
    inputs: [],
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.some((e) => e.includes("name")));
});

test("rejects missing flow.id AND flow.name", () => {
  const result = validateFlowTrigger({
    name: "x",
    description: "x",
    flow: {},
    inputs: [],
  });
  assert.equal(result.ok, false);
});

test("accepts flow.name as alternative to flow.id", () => {
  const result = validateFlowTrigger({
    name: "x",
    description: "x",
    flow: { name: "My Flow" },
    inputs: [],
  });
  assert.ok(result.ok);
});

test("rejects invalid input type", () => {
  const result = validateFlowTrigger({
    name: "x",
    description: "x",
    flow: { id: "y" },
    inputs: [{ name: "f", type: "rocket", required: true, flowField: "input_file" }],
  });
  assert.equal(result.ok, false);
});

test("rejects non-string command name", () => {
  const result = validateFlowTrigger({
    name: 42,
    description: "x",
    flow: { id: "y" },
    inputs: [],
  });
  assert.equal(result.ok, false);
});

test("rejects command name containing whitespace", () => {
  const result = validateFlowTrigger({
    name: "bad name",
    description: "x",
    flow: { id: "y" },
    inputs: [],
  });
  assert.equal(result.ok, false);
});
