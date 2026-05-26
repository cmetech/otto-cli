/**
 * Regression tests for status/quick behavior.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { handleCoreCommand } from "../commands/handlers/core.ts";
import { buildQuickCommitInstruction } from "../quick.ts";

describe("status command routing", () => {
  test("core handler routes status command to visualizer fallback in non-UI contexts", async () => {
    const notifications: Array<{ message: string; level: string }> = [];
    const ctx = {
      ui: {
        custom: async () => undefined,
        notify: (message: string, level: string) => {
          notifications.push({ message, level });
        },
      },
    };

    const handled = await handleCoreCommand("status", ctx as any);

    assert.equal(handled, true);
    assert.match(notifications[0]?.message ?? "", /interactive terminal/i);
  });

  test("quick task commit instructions handle external .otto/workflow roots without staging quick files", () => {
    const instruction = buildQuickCommitInstruction("/project", "/external/.otto/workflow");

    assert.match(instruction, /do not stage or commit `\.otto\/workflow\/quick\/\.\.\.`/);
    assert.match(instruction, /nothing in the project repo to commit/);
  });

  test("quick task commit instructions include normal commit guidance for in-project .otto/workflow roots", () => {
    const instruction = buildQuickCommitInstruction("/project", "/project/.otto/workflow");

    assert.doesNotMatch(instruction, /nothing in the project repo to commit/);
    assert.match(instruction, /Commit your changes atomically/);
  });
});
