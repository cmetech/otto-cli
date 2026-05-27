import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "..", "tools", "scripts", "validate_flow.sh");

function writeFlow(dir: string, targetType: string): string {
  const path = join(dir, `flow-${targetType}.json`);
  const sourceHandle = {
    dataType: "AnthropicModel",
    id: "AnthropicModel-otto-gateway",
    name: "text_output",
    output_types: ["Message"],
  };
  const targetHandle = {
    fieldName: "input_value",
    id: "ChatOutput-chat-output",
    inputTypes: ["Data", "JSON", "DataFrame", "Table", "Message"],
    type: targetType,
  };
  writeFileSync(path, JSON.stringify({
    name: `flow-${targetType}`,
    data: {
      nodes: [
        {
          id: "AnthropicModel-otto-gateway",
          data: {
            type: "AnthropicModel",
            node: {
              outputs: [{ name: "text_output", types: ["Message"] }],
              template: {},
            },
          },
        },
        {
          id: "ChatOutput-chat-output",
          data: {
            type: "ChatOutput",
            node: {
              outputs: [],
              template: {
                input_value: {
                  type: "other",
                  input_types: ["Data", "JSON", "DataFrame", "Table", "Message"],
                },
              },
            },
          },
        },
      ],
      edges: [
        {
          id: "edge-AnthropicModel-otto-gateway-ChatOutput-chat-output",
          source: "AnthropicModel-otto-gateway",
          target: "ChatOutput-chat-output",
          sourceHandle: JSON.stringify(sourceHandle),
          targetHandle: JSON.stringify(targetHandle),
          data: { sourceHandle, targetHandle },
        },
      ],
    },
  }, null, 2));
  return path;
}

test("validate_flow rejects ChatOutput input_value handle type mismatches", () => {
  const dir = mkdtempSync(join(tmpdir(), "otto-validate-flow-"));
  try {
    const bad = writeFlow(dir, "str");
    const result = spawnSync(script, [bad], { encoding: "utf-8" });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /target handle type 'str' does not match ChatOutput-chat-output\.input_value type 'other'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("validate_flow accepts ChatOutput input_value handle type from template metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "otto-validate-flow-"));
  try {
    const good = writeFlow(dir, "other");

    const output = execFileSync(script, [good], { encoding: "utf-8" });
    assert.match(output, /Graph edge validation: OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
