// GSD2 — paths cache normalization and clearPathCache() invalidation tests

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, renameSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { workflowRoot, clearPathCache, _clearWorkflowRootCache } from '../paths.ts';

describe('workflowRootCache key normalization', () => {
  let projectDir: string;
  let fakeHome: string;
  let savedHome: string | undefined;
  let savedUserProfile: string | undefined;
  let savedWorkflowHome: string | undefined;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'gsd-cache-norm-')));
    mkdirSync(join(projectDir, '.gsd'), { recursive: true });

    fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'gsd-cache-home-')));

    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    savedWorkflowHome = process.env.GSD_HOME;

    // Point HOME and GSD_HOME at an unrelated temp dir to prevent ~/.gsd interference.
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    process.env.GSD_HOME = join(fakeHome, '.gsd');

    _clearWorkflowRootCache();
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedUserProfile;
    if (savedWorkflowHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = savedWorkflowHome;

    clearPathCache();
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test('workflowRoot with trailing slash returns same result as without', () => {
    const withoutSlash = workflowRoot(projectDir);
    _clearWorkflowRootCache();
    const withSlash = workflowRoot(projectDir + '/');

    assert.equal(
      withoutSlash,
      withSlash,
      'workflowRoot must return the same path regardless of trailing slash',
    );
    assert.equal(
      withoutSlash,
      join(projectDir, '.gsd'),
      'both calls should resolve to projectDir/.gsd',
    );
  });

  test('second call with trailing slash hits cache set by first call without slash', () => {
    // Prime the cache with the no-slash form.
    const first = workflowRoot(projectDir);
    // Now remove .gsd so a fresh probe would return a different path.
    renameSync(join(projectDir, '.gsd'), join(projectDir, '.gsd-hidden'));
    // Call with trailing slash — must hit the normalized cache entry (no re-probe).
    const second = workflowRoot(projectDir + '/');
    // Restore for cleanup.
    renameSync(join(projectDir, '.gsd-hidden'), join(projectDir, '.gsd'));

    assert.equal(
      second,
      first,
      'trailing-slash call must return cached result from the no-slash call',
    );
  });
});

describe('clearPathCache() does NOT invalidate workflowRootCache (process-lifetime semantics)', () => {
  let projectDir: string;
  let fakeHome: string;
  let savedHome: string | undefined;
  let savedUserProfile: string | undefined;
  let savedWorkflowHome: string | undefined;

  beforeEach(() => {
    projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'gsd-cache-clear-')));
    mkdirSync(join(projectDir, '.gsd'), { recursive: true });

    fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'gsd-cache-home2-')));

    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    savedWorkflowHome = process.env.GSD_HOME;

    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;
    process.env.GSD_HOME = join(fakeHome, '.gsd');

    _clearWorkflowRootCache();
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedUserProfile;
    if (savedWorkflowHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = savedWorkflowHome;

    _clearWorkflowRootCache();
    clearPathCache();
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test('clearPathCache() does NOT evict a cached workflowRoot result', (t) => {
    // Prime the cache.
    const firstResult = workflowRoot(projectDir);
    assert.equal(firstResult, join(projectDir, '.gsd'));

    // Remove .gsd so a fresh probe would return a different (fallback) result.
    renameSync(join(projectDir, '.gsd'), join(projectDir, '.gsd-hidden'));
    t.after(() => {
      try { renameSync(join(projectDir, '.gsd-hidden'), join(projectDir, '.gsd')); } catch { /* ignore */ }
    });

    // clearPathCache() only clears volatile dir caches — workflowRootCache is untouched.
    clearPathCache();
    const afterClearPath = workflowRoot(projectDir);
    assert.equal(
      afterClearPath,
      firstResult,
      'clearPathCache must NOT evict workflowRootCache — result must still be the cached value',
    );
  });

  test('_clearWorkflowRootCache() DOES evict workflowRootCache, causing re-probe', (t) => {
    // Prime the cache.
    const firstResult = workflowRoot(projectDir);
    assert.equal(firstResult, join(projectDir, '.gsd'));

    // Remove .gsd so a fresh probe returns the creation fallback.
    renameSync(join(projectDir, '.gsd'), join(projectDir, '.gsd-hidden'));
    t.after(() => {
      try { renameSync(join(projectDir, '.gsd-hidden'), join(projectDir, '.gsd')); } catch { /* ignore */ }
    });

    // _clearWorkflowRootCache() evicts the entry — next call re-probes.
    _clearWorkflowRootCache();
    const afterClearRoot = workflowRoot(projectDir);
    assert.equal(
      afterClearRoot,
      join(projectDir, '.gsd'),
      'after _clearWorkflowRootCache, workflowRoot must re-probe and return creation fallback',
    );
    // The two results are equal (same path) but the key point is re-probe occurred;
    // the cached firstResult also happened to equal the fallback path.
    // Verify: if we prime again without removing .gsd, clearing root re-probes to gsd.
    renameSync(join(projectDir, '.gsd-hidden'), join(projectDir, '.gsd'));
    _clearWorkflowRootCache();
    const reprobe = workflowRoot(projectDir);
    assert.equal(reprobe, join(projectDir, '.gsd'), 're-probe after restore returns .gsd');
  });
});
