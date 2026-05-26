/**
 * Regression test for #3477: otto_skip_slice updates DB state and rebuilds
 * the projected STATE.md artifact.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { registerDbTools } from "../bootstrap/db-tools.ts";
import {
  closeDatabase,
  getSlice,
  insertMilestone,
  insertSlice,
  openDatabase,
} from "../db.ts";

test("otto_skip_slice marks a slice skipped and refreshes STATE.md", async () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-skip-slice-"));
  const tools = new Map<string, any>();
  const pi = { registerTool: (tool: any) => tools.set(tool.name, tool) };

  try {
    mkdirSync(join(base, ".otto/workflow", "milestones", "M001", "slices", "S01"), { recursive: true });
    openDatabase(join(base, ".otto/workflow", "otto.db"));
    insertMilestone({ id: "M001", title: "Skip Test", status: "active", depends_on: [] });
    insertSlice({
      id: "S01",
      milestoneId: "M001",
      title: "Skipped slice",
      status: "pending",
      risk: "low",
      depends: [],
      demo: "",
      sequence: 1,
    });

    registerDbTools(pi as any);
    const skipSlice = tools.get("otto_skip_slice");
    assert.ok(skipSlice, "otto_skip_slice is registered");

    const result = await skipSlice.execute(
      "tool-call",
      { milestoneId: "M001", sliceId: "S01", reason: "descoped" },
      undefined,
      undefined,
      { cwd: base },
    );

    assert.equal(result.details.operation, "skip_slice");
    assert.equal(getSlice("M001", "S01")?.status, "skipped");

    const statePath = join(base, ".otto/workflow", "STATE.md");
    assert.equal(existsSync(statePath), true, "STATE.md should be rebuilt");
    assert.match(readFileSync(statePath, "utf-8"), /Active Slice:\*\* None/);
  } finally {
    closeDatabase();
    rmSync(base, { recursive: true, force: true });
  }
});
