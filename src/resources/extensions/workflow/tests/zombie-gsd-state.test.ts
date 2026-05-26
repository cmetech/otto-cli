/**
 * zombie-gsd-state.test.ts — #2942
 *
 * A partially initialized `.otto/workflow/` (symlink exists but neither `PREFERENCES.md`
 * nor `milestones/` is present) previously caused the init-wizard gate in
 * `showSmartEntry` to be skipped. The fix introduces
 * `hasWorkflowBootstrapArtifacts`, which requires at least one bootstrap artifact
 * to be present before treating the project as initialized.
 *
 * These tests exercise that helper directly over synthetic filesystems and
 * injected predicates — replacing the old source-grep assertions that only
 * verified the function's *text* shape.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { hasWorkflowBootstrapArtifacts } from "../detection.ts";

function makeWorkflowDir(t: { after: (fn: () => void) => void }): string {
  const dir = mkdtempSync(join(tmpdir(), "gsd-zombie-state-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("#2942: missing .otto/workflow/ directory entirely → treated as un-bootstrapped", () => {
  assert.equal(
    hasWorkflowBootstrapArtifacts("/nonexistent/path/does/not/exist/.otto/workflow"),
    false,
  );
});

test("#2942: zombie .otto/workflow/ (empty directory) must NOT count as bootstrapped", (t) => {
  const gsd = makeWorkflowDir(t);
  // Only the directory exists — neither PREFERENCES.md nor milestones/
  assert.equal(
    hasWorkflowBootstrapArtifacts(gsd),
    false,
    "an empty .otto/workflow/ is a zombie state — init wizard must still run",
  );
});

test("#2942: .otto/workflow/ with PREFERENCES.md counts as bootstrapped", (t) => {
  const gsd = makeWorkflowDir(t);
  writeFileSync(join(gsd, "PREFERENCES.md"), "# prefs\n");
  assert.equal(hasWorkflowBootstrapArtifacts(gsd), true);
});

test("#2942: .otto/workflow/ with milestones/ directory counts as bootstrapped", (t) => {
  const gsd = makeWorkflowDir(t);
  mkdirSync(join(gsd, "milestones"));
  assert.equal(hasWorkflowBootstrapArtifacts(gsd), true);
});

test("#2942: both artifacts present → bootstrapped", (t) => {
  const gsd = makeWorkflowDir(t);
  writeFileSync(join(gsd, "PREFERENCES.md"), "# prefs\n");
  mkdirSync(join(gsd, "milestones"));
  assert.equal(hasWorkflowBootstrapArtifacts(gsd), true);
});

test("#2942: injected existsFn — zombie via predicate is rejected", () => {
  // Only the .otto/workflow/ directory exists; artifacts are missing.
  const existsFn = (p: string) => p === "/proj/.otto/workflow";
  assert.equal(hasWorkflowBootstrapArtifacts("/proj/.otto/workflow", existsFn), false);
});

test("#2942: injected existsFn — PREFERENCES.md alone is enough", () => {
  const existsFn = (p: string) =>
    p === "/proj/.otto/workflow" || p === "/proj/.otto/workflow/PREFERENCES.md";
  assert.equal(hasWorkflowBootstrapArtifacts("/proj/.otto/workflow", existsFn), true);
});

test("#2942: injected existsFn — milestones/ alone is enough", () => {
  const existsFn = (p: string) =>
    p === "/proj/.otto/workflow" || p === "/proj/.otto/workflow/milestones";
  assert.equal(hasWorkflowBootstrapArtifacts("/proj/.otto/workflow", existsFn), true);
});
