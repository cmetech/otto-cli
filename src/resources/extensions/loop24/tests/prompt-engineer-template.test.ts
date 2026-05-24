import { test } from "node:test";
import assert from "node:assert/strict";
import { PROMPT_ENGINEER_SYSTEM } from "../commands/prompt-engineer/_template.js";

test("PROMPT_ENGINEER_SYSTEM is non-trivial and mentions the polish task", () => {
  assert.ok(typeof PROMPT_ENGINEER_SYSTEM === "string");
  assert.ok(PROMPT_ENGINEER_SYSTEM.length > 400, "expected a non-trivial system prompt");
  assert.match(PROMPT_ENGINEER_SYSTEM, /polish|polished|polishing/i);
  assert.match(PROMPT_ENGINEER_SYSTEM, /coding agent|llm|claude/i);
});

test("PROMPT_ENGINEER_SYSTEM does NOT instruct the model to add preamble", () => {
  assert.match(PROMPT_ENGINEER_SYSTEM, /no preamble|without preamble|do not include|don't include|output only/i);
});
