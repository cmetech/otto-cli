/**
 * Test isolation utilities for integration tests.
 *
 * Integration tests often call `mergeMilestoneToMain` and other functions that
 * load preferences. If the user's global ~/.loop24/preferences.md has
 * `git.main_branch: master`, tests fail because test repos use `main`.
 *
 * These utilities isolate tests from the user's global environment.
 */

import { mkdtempSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _resetServiceCache } from "../../worktree.ts";
import { _clearWorkflowRootCache } from "../../paths.ts";

let originalHome: string | undefined;
let fakeHome: string | null = null;

/**
 * Isolate the test environment from user's global preferences.
 * Creates a fake HOME directory so loadEffectiveGSDPreferences() returns
 * empty global preferences instead of the user's ~/.loop24/preferences.md.
 *
 * Call this in a test.before() hook.
 */
export function isolateFromGlobalPreferences(): void {
  originalHome = process.env.HOME;
  fakeHome = realpathSync(mkdtempSync(join(tmpdir(), "gsd-test-home-")));
  process.env.HOME = fakeHome;
  _clearWorkflowRootCache();
  _resetServiceCache();
}

/**
 * Restore the original HOME and clean up the fake home directory.
 *
 * Call this in a test.after() hook.
 */
export function restoreGlobalPreferences(): void {
  if (originalHome !== undefined) {
    process.env.HOME = originalHome;
  } else {
    delete process.env.HOME;
  }
  _clearWorkflowRootCache();
  _resetServiceCache();
  if (fakeHome) {
    rmSync(fakeHome, { recursive: true, force: true });
    fakeHome = null;
  }
}
