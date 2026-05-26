// Project/App: OTTO
// File Purpose: Behavior tests for auto-mode project-root environment cleanup.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cleanupAfterLoopExit,
  _captureProjectRootEnvForTest,
  _restoreProjectRootEnvForTest,
} from "../auto.ts";
import { autoSession } from "../auto-runtime-state.ts";

test.afterEach(() => {
  _restoreProjectRootEnvForTest();
});

test("auto-mode project-root env capture sets OTTO_PROJECT_ROOT and restores an existing value", () => {
  delete process.env.OTTO_PROJECT_ROOT;
  process.env.OTTO_PROJECT_ROOT = "/before";

  _captureProjectRootEnvForTest("/project");
  assert.equal(process.env.OTTO_PROJECT_ROOT, "/project");

  _restoreProjectRootEnvForTest();
  assert.equal(process.env.OTTO_PROJECT_ROOT, "/before");
  assert.equal(process.env.OTTO_PROJECT_ROOT, "/before");
  delete process.env.OTTO_PROJECT_ROOT;
  delete process.env.OTTO_PROJECT_ROOT;
});

test("auto-mode project-root env restore deletes OTTO_PROJECT_ROOT when it was initially absent", () => {
  delete process.env.OTTO_PROJECT_ROOT;
  delete process.env.OTTO_PROJECT_ROOT;

  _captureProjectRootEnvForTest("/project");
  assert.equal(process.env.OTTO_PROJECT_ROOT, "/project");

  _restoreProjectRootEnvForTest();
  assert.equal(process.env.OTTO_PROJECT_ROOT, undefined);
  assert.equal(process.env.OTTO_PROJECT_ROOT, undefined);
});

test("cleanupAfterLoopExit restores captured OTTO_PROJECT_ROOT", async () => {
  const base = mkdtempSync(join(tmpdir(), "gsd-project-root-env-"));
  const previousCwd = process.cwd();
  const previousProjectRoot = process.env.OTTO_PROJECT_ROOT;

  autoSession.reset();
  autoSession.active = true;
  autoSession.basePath = join(base, ".otto/workflow", "worktrees", "M001");
  autoSession.originalBasePath = base;
  autoSession.projectRootEnvCaptured = true;
  autoSession.hadProjectRootEnv = true;
  autoSession.previousProjectRootEnv = "/previous/project";
  process.env.OTTO_PROJECT_ROOT = base;

  try {
    await cleanupAfterLoopExit({
      ui: {
        setStatus: () => {},
        setWidget: () => {},
        notify: () => {},
      },
    } as any);

    assert.equal(process.env.OTTO_PROJECT_ROOT, "/previous/project");
    assert.equal(autoSession.projectRootEnvCaptured, false);
    assert.equal(autoSession.previousProjectRootEnv, null);
  } finally {
    autoSession.reset();
    process.chdir(previousCwd);
    if (previousProjectRoot === undefined) delete process.env.OTTO_PROJECT_ROOT;
    else process.env.OTTO_PROJECT_ROOT = previousProjectRoot;
    rmSync(base, { recursive: true, force: true });
  }
});
