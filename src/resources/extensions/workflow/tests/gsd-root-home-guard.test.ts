/**
 * GSD2 — regression tests for #5187 and git-root anchor guard:
 *
 * #5187: workflowRoot() must refuse to use the global OTTO home (~/.otto) as a
 * project .otto/workflow directory when basePath resolves to $HOME. Paths under
 * ~/.otto/workflow/projects/<hash>/ remain valid.
 *
 * git-root anchor guard: when $HOME is itself a git repo and ~/.otto exists,
 * workflowRoot() must NOT return ~/.otto for a subdir basePath like ~/projects/foo.
 * It should fall through to step 4 (creation fallback) instead.
 */

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { workflowRoot, workflowRootOrNull, _clearWorkflowRootCache } from '../paths.ts';

describe('workflowRoot() refuses ~/.otto as project state when basePath is $HOME (#5187)', () => {
  let fakeHome: string;
  let savedHome: string | undefined;
  let savedUserProfile: string | undefined;
  let savedWorkflowHome: string | undefined;

  beforeEach(() => {
    fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'gsd-home-guard-')));
    mkdirSync(join(fakeHome, '.otto/workflow'), { recursive: true });

    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    savedWorkflowHome = process.env.OTTO_HOME;

    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    delete process.env.OTTO_HOME;

    _clearWorkflowRootCache();
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedUserProfile;
    if (savedWorkflowHome === undefined) delete process.env.OTTO_HOME;
    else process.env.OTTO_HOME = savedWorkflowHome;

    _clearWorkflowRootCache();
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test('throws when basePath is the home directory and result equals workflowHome()', () => {
    assert.throws(
      () => workflowRoot(fakeHome),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'should throw an Error');
        assert.match(
          (err as Error).message,
          /home directory|project workflow directory/i,
          'message should explain the refusal',
        );
        return true;
      },
    );
  });

  test('workflowRootOrNull returns null for home directory global workflow state', () => {
    assert.equal(
      workflowRootOrNull(fakeHome),
      null,
      'non-throwing project detection must not treat ~/.otto/workflow as a project',
    );
  });

  test('does NOT throw for paths under ~/.otto/workflow/projects/<hash>/', () => {
    const projectStateDir = join(fakeHome, '.otto/workflow', 'projects', 'abcdef123456');
    mkdirSync(join(projectStateDir, '.otto/workflow'), { recursive: true });
    _clearWorkflowRootCache();

    const resolved = workflowRoot(projectStateDir);
    assert.equal(resolved, join(projectStateDir, '.otto/workflow'));
    assert.equal(workflowRootOrNull(projectStateDir), join(projectStateDir, '.otto/workflow'));
  });

  test('does NOT throw for an unrelated project directory that has its own .otto/workflow', () => {
    const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'gsd-home-guard-proj-')));
    mkdirSync(join(projectDir, '.otto/workflow'), { recursive: true });
    _clearWorkflowRootCache();
    try {
      const resolved = workflowRoot(projectDir);
      assert.equal(resolved, join(projectDir, '.otto/workflow'));
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});

describe('git-root anchor guard: subdir basePath must not resolve to ~/.otto', () => {
  let fakeHome: string;
  let subDir: string;
  let savedHome: string | undefined;
  let savedUserProfile: string | undefined;
  let savedWorkflowHome: string | undefined;

  beforeEach(() => {
    // Create a tmpdir that will act as both $HOME and a git repo root.
    fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'gsd-anchor-guard-')));
    // Init a bare-minimum git repo so git rev-parse --show-toplevel returns fakeHome.
    spawnSync('git', ['init', fakeHome], { encoding: 'utf-8' });
    // Create ~/.otto (the global home that must NOT be used for project subdirs).
    mkdirSync(join(fakeHome, '.otto/workflow'), { recursive: true });
    // Create a subdir inside the git repo — this is the project basePath.
    subDir = join(fakeHome, 'projects', 'foo');
    mkdirSync(subDir, { recursive: true });

    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    savedWorkflowHome = process.env.OTTO_HOME;

    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    delete process.env.OTTO_HOME;

    _clearWorkflowRootCache();
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedUserProfile;
    if (savedWorkflowHome === undefined) delete process.env.OTTO_HOME;
    else process.env.OTTO_HOME = savedWorkflowHome;

    _clearWorkflowRootCache();
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test('does NOT return ~/.otto when $HOME is a git repo and basePath is a subdir', () => {
    // fakeHome IS the git root AND $HOME, so git rev-parse returns fakeHome,
    // and ~/.otto (fakeHome/.otto/workflow) exists. The guard must skip that candidate
    // and fall through to the creation fallback: subDir/.otto/workflow.
    const result = workflowRoot(subDir);
    assert.notEqual(
      result,
      join(fakeHome, '.otto/workflow'),
      'workflowRoot must not return ~/.otto for a subdir basePath',
    );
    assert.equal(
      result,
      join(subDir, '.otto/workflow'),
      'workflowRoot should fall through to the creation fallback for a subdir',
    );
  });
});
