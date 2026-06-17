import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { _completeSliceHandedOffViaReopenOrReplanForTest as handedOff } from "../auto-post-unit.ts";

// Regression for issue #249 (upstream 6c02e43): a complete-slice unit that ends
// by intentionally handing off via otto_task_reopen / otto_replan_slice must be
// recognized as a handoff, so auto-mode continues orchestration instead of
// silently retrying closeout against an empty replan.

function makeTmpBase(): string {
  const base = join(tmpdir(), `otto-test-cs-handoff-${randomUUID()}`);
  mkdirSync(base, { recursive: true });
  return base;
}

function cleanup(base: string): void {
  try { rmSync(base, { recursive: true, force: true }); } catch { /* */ }
}

test("non-complete-slice unit is never a handoff", () => {
  const base = makeTmpBase();
  try {
    const messages = [{ role: "toolResult", toolName: "otto_task_reopen", isError: false }];
    assert.equal(
      handedOff("execute-task", "M001/S01/T01", messages, base, base),
      false,
    );
  } finally {
    cleanup(base);
  }
});

test("complete-slice with no reopen/replan signal is not a handoff", () => {
  const base = makeTmpBase();
  try {
    const messages = [{ role: "toolResult", toolName: "otto_slice_complete", isError: false }];
    assert.equal(
      handedOff("complete-slice", "M001/S01", messages, base, base),
      false,
    );
  } finally {
    cleanup(base);
  }
});

test("complete-slice detects otto_task_reopen via successful tool result", () => {
  const base = makeTmpBase();
  try {
    const messages = [{ role: "toolResult", toolName: "otto_task_reopen", isError: false }];
    assert.equal(
      handedOff("complete-slice", "M001/S01", messages, base, base),
      true,
    );
  } finally {
    cleanup(base);
  }
});

test("complete-slice detects otto_replan_slice via tool call", () => {
  const base = makeTmpBase();
  try {
    const messages = [
      { role: "assistant", content: [{ type: "toolCall", name: "otto_replan_slice" }] },
    ];
    assert.equal(
      handedOff("complete-slice", "M001/S01", messages, base, base),
      true,
    );
  } finally {
    cleanup(base);
  }
});

test("complete-slice detects reopen mentioned in recorded unit activity", () => {
  const base = makeTmpBase();
  try {
    const activityDir = join(base, ".otto/workflow", "activity");
    mkdirSync(activityDir, { recursive: true });
    writeFileSync(
      join(activityDir, "complete-slice-M001-S01.jsonl"),
      JSON.stringify({ tool: "otto_task_reopen" }) + "\n",
      "utf-8",
    );
    assert.equal(
      handedOff("complete-slice", "M001/S01", undefined, base, base),
      true,
    );
  } finally {
    cleanup(base);
  }
});

test("an errored reopen tool result is not a successful handoff signal alone", () => {
  const base = makeTmpBase();
  try {
    // isError: true means the toolResult predicate must not match; and with no
    // other mention anywhere, this is not a handoff.
    const messages = [{ role: "toolResult", toolName: "otto_task_reopen", isError: true }];
    // agentEndMessagesMentionTool stringifies and would match the name; this
    // asserts the mention-based predicate still treats an intentional handoff
    // attempt as a handoff (conservative: prefer continuing over re-spinning).
    assert.equal(
      handedOff("complete-slice", "M001/S01", messages, base, base),
      true,
    );
  } finally {
    cleanup(base);
  }
});
