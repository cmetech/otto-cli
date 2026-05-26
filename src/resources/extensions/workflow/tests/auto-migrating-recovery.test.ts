import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { recoverFailedMigration } from "../migrate-external.ts";

// Regression tests for #4416: `.otto/workflow.migrating` must be healed before auto-mode
// proceeds, including on the resume path in auto.ts (fixed at auto.ts:1325).
// The `recoverFailedMigration` function is already called in `auto-start.ts:350`
// for fresh-start sessions. The fix adds an identical call to `auto.ts:startAuto`
// so that resume sessions (triggered by a persisted paused-session.json) also heal
// a leftover `.otto/workflow.migrating` directory before acquiring the session lock.

test("recoverFailedMigration renames .otto/workflow.migrating to .otto/workflow when .otto/workflow is absent", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-migrating-recovery-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const migratingPath = join(base, ".otto/workflow.migrating");
  mkdirSync(join(migratingPath, "milestones"), { recursive: true });

  const recovered = recoverFailedMigration(base);

  assert.equal(recovered, true, "expected recovery to succeed");
  assert.ok(existsSync(join(base, ".otto/workflow")), ".otto/workflow must exist after recovery");
  assert.ok(!existsSync(migratingPath), ".otto/workflow.migrating must not exist after recovery");
});

test("recoverFailedMigration returns false when .otto/workflow.migrating is absent (nothing to do)", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-migrating-noop-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const recovered = recoverFailedMigration(base);
  assert.equal(recovered, false, "no migration to recover");
});

test("recoverFailedMigration returns false when both .otto/workflow and .otto/workflow.migrating exist (ambiguous)", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-migrating-ambig-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  mkdirSync(join(base, ".otto/workflow"), { recursive: true });
  mkdirSync(join(base, ".otto/workflow.migrating"), { recursive: true });

  const recovered = recoverFailedMigration(base);
  assert.equal(recovered, false, "should not touch ambiguous state");
  assert.ok(existsSync(join(base, ".otto/workflow")), ".otto/workflow must still exist");
  assert.ok(existsSync(join(base, ".otto/workflow.migrating")), ".otto/workflow.migrating must still exist");
});

test("recoverFailedMigration preserves contents of .otto/workflow.migrating", (t) => {
  const base = mkdtempSync(join(tmpdir(), "gsd-migrating-contents-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));

  const migratingPath = join(base, ".otto/workflow.migrating");
  mkdirSync(join(migratingPath, "milestones", "M001"), { recursive: true });
  writeFileSync(join(migratingPath, "milestones", "M001", "M001-ROADMAP.md"), "# M001\n");

  recoverFailedMigration(base);

  const roadmap = join(base, ".otto/workflow", "milestones", "M001", "M001-ROADMAP.md");
  assert.ok(existsSync(roadmap), "Milestone file must be accessible via .otto/workflow after recovery");
});
