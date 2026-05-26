import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadFlowTriggers } from "../commands/flow-triggers/_loader.js";

function withTempDir(fn: (dir: string) => void | Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "otto-flow-triggers-"));
  return Promise.resolve(fn(dir)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

test("returns empty array when directory has no YAML files", async () => {
  await withTempDir(async (dir) => {
    const result = await loadFlowTriggers(dir);
    assert.deepEqual(result.commands, []);
    assert.deepEqual(result.errors, []);
  });
});

test("loads a valid YAML file", async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, "echo.yaml"), `
name: echo
description: Echo a message
flow:
  id: echo-flow
inputs:
  - name: msg
    type: string
    required: true
    flowField: input_value
`);
    const result = await loadFlowTriggers(dir);
    assert.equal(result.commands.length, 1);
    assert.equal(result.commands[0]?.name, "echo");
    assert.equal(result.errors.length, 0);
  });
});

test("skips files starting with underscore (loader-internal convention)", async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, "_skip-me.yaml"), `name: should-not-load
description: x
flow: { id: y }
inputs: []
`);
    const result = await loadFlowTriggers(dir);
    assert.equal(result.commands.length, 0);
  });
});

test("collects errors from invalid YAML without throwing", async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, "broken.yaml"), `name: 42
flow: not an object
`);
    const result = await loadFlowTriggers(dir);
    assert.equal(result.commands.length, 0);
    assert.equal(result.errors.length, 1);
    assert.ok(result.errors[0]?.file.endsWith("broken.yaml"));
    assert.ok(result.errors[0]?.message.length > 0);
  });
});

test("loads multiple files in deterministic alphabetical order", async () => {
  await withTempDir(async (dir) => {
    writeFileSync(join(dir, "zebra.yaml"), `name: zebra\ndescription: z\nflow: { id: z }\ninputs: []\n`);
    writeFileSync(join(dir, "alpha.yaml"), `name: alpha\ndescription: a\nflow: { id: a }\ninputs: []\n`);
    const result = await loadFlowTriggers(dir);
    assert.deepEqual(result.commands.map((c) => c.name), ["alpha", "zebra"]);
  });
});
