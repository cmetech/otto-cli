import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { LANGFLOW_INTENT_EVALS } from "../commands/langflow/intent-evals.js";
import { parseLangFlowNaturalLanguage } from "../commands/langflow/natural-language.js";
import { LANGFLOW_TOOL_ACTIONS } from "../tools/langflow.js";

const skillPath = join(
  process.cwd(),
  "src/resources/extensions/otto/skills/langflow/SKILL.md",
);

test("LangFlow natural-language skill is bundled and points at otto__langflow", () => {
  assert.ok(existsSync(skillPath), "expected bundled LangFlow skill");
  const skill = readFileSync(skillPath, "utf-8");
  assert.match(skill, /name:\s*langflow/);
  assert.match(skill, /otto__langflow/);
  assert.match(skill, /Do not retry/i);
  assert.match(skill, /\/otto langflow connect/);
  for (const action of LANGFLOW_TOOL_ACTIONS) {
    assert.match(skill, new RegExp(action), `skill should document ${action}`);
  }
});

test("LangFlow natural-language eval phrases cover common actions", () => {
  const actions = new Set(LANGFLOW_TOOL_ACTIONS);
  for (const item of LANGFLOW_INTENT_EVALS) {
    assert.ok(item.prompt.trim(), "eval prompt must be non-empty");
    assert.ok(actions.has(item.action), `unknown LangFlow action in eval: ${item.action}`);
  }
  assert.ok(LANGFLOW_INTENT_EVALS.some((item) => /build/i.test(item.prompt) && item.action === "build_flow"));
  assert.ok(LANGFLOW_INTENT_EVALS.some((item) => /starting with/i.test(item.prompt) && item.action === "list_flows"));
  assert.ok(LANGFLOW_INTENT_EVALS.some((item) => /import/i.test(item.prompt) && item.action === "import_flow"));
  assert.ok(LANGFLOW_INTENT_EVALS.some((item) => /export/i.test(item.prompt) && item.action === "export_flow"));
});

test("LangFlow natural-language parser routes list flow requests deterministically", () => {
  assert.deepEqual(parseLangFlowNaturalLanguage("can we list the langflow flows"), {
    action: "list_flows",
    prefix: undefined,
  });
  assert.deepEqual(parseLangFlowNaturalLanguage("Show me all LangFlow flows starting with otto"), {
    action: "list_flows",
    prefix: "otto",
  });
});
