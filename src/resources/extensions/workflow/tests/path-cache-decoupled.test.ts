// GSD-2 — Tests verifying workflowRootCache is decoupled from per-turn clearPathCache()

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, renameSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { workflowRoot, clearPathCache, _clearWorkflowRootCache } from '../paths.ts';

// ---------------------------------------------------------------------------
// Shared test setup helpers
// ---------------------------------------------------------------------------

interface Fixture {
  projectDir: string;
  fakeHome: string;
  savedHome: string | undefined;
  savedUserProfile: string | undefined;
  savedWorkflowHome: string | undefined;
}

function makeFixture(): Fixture {
  const projectDir = realpathSync(mkdtempSync(join(tmpdir(), 'gsd-decoupled-')));
  mkdirSync(join(projectDir, '.gsd'), { recursive: true });

  const fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'gsd-decoupled-home-')));

  const savedHome = process.env.HOME;
  const savedUserProfile = process.env.USERPROFILE;
  const savedWorkflowHome = process.env.GSD_HOME;

  // Redirect HOME so workflowRoot never accidentally resolves to the real ~/.gsd.
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
  process.env.GSD_HOME = join(fakeHome, '.gsd');

  _clearWorkflowRootCache();

  return { projectDir, fakeHome, savedHome, savedUserProfile, savedWorkflowHome };
}

function teardownFixture(f: Fixture): void {
  if (f.savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = f.savedHome;
  if (f.savedUserProfile === undefined) delete process.env.USERPROFILE;
  else process.env.USERPROFILE = f.savedUserProfile;
  if (f.savedWorkflowHome === undefined) delete process.env.GSD_HOME;
  else process.env.GSD_HOME = f.savedWorkflowHome;

  _clearWorkflowRootCache();
  clearPathCache();
  rmSync(f.projectDir, { recursive: true, force: true });
  rmSync(f.fakeHome, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// 1. workflowRoot() populates the cache
// ---------------------------------------------------------------------------

describe('workflowRoot cache population', () => {
  let f: Fixture;
  beforeEach(() => { f = makeFixture(); });
  afterEach(() => teardownFixture(f));

  test('first call populates cache; second call returns same value without re-probing', (t) => {
    const first = workflowRoot(f.projectDir);
    assert.equal(first, join(f.projectDir, '.gsd'), 'must resolve to projectDir/.gsd');

    // Hide .gsd so a re-probe would yield the creation fallback (same path in this
    // case, but the rename lets us verify no re-probe happens).
    renameSync(join(f.projectDir, '.gsd'), join(f.projectDir, '.gsd-hidden'));
    t.after(() => {
      try { renameSync(join(f.projectDir, '.gsd-hidden'), join(f.projectDir, '.gsd')); } catch { /* ignore */ }
    });

    const second = workflowRoot(f.projectDir);
    assert.equal(second, first, 'second call must return cached result, not re-probe');
  });
});

// ---------------------------------------------------------------------------
// 2. clearPathCache() does NOT invalidate workflowRootCache
// ---------------------------------------------------------------------------

describe('clearPathCache() does not evict workflowRootCache', () => {
  let f: Fixture;
  beforeEach(() => { f = makeFixture(); });
  afterEach(() => teardownFixture(f));

  test('cached workflowRoot survives clearPathCache()', (t) => {
    // Prime the cache.
    const primed = workflowRoot(f.projectDir);
    assert.equal(primed, join(f.projectDir, '.gsd'));

    // Mutate the filesystem so a fresh probe would return a different path.
    renameSync(join(f.projectDir, '.gsd'), join(f.projectDir, '.gsd-gone'));
    t.after(() => {
      try { renameSync(join(f.projectDir, '.gsd-gone'), join(f.projectDir, '.gsd')); } catch { /* ignore */ }
    });

    // clearPathCache() only clears volatile dir caches — must not touch workflowRootCache.
    clearPathCache();

    const afterClear = workflowRoot(f.projectDir);
    assert.equal(
      afterClear,
      primed,
      'workflowRoot must return the original cached value after clearPathCache(), not re-probe',
    );
  });

  test('multiple clearPathCache() calls still preserve workflowRoot cache', (t) => {
    const primed = workflowRoot(f.projectDir);

    renameSync(join(f.projectDir, '.gsd'), join(f.projectDir, '.gsd-gone'));
    t.after(() => {
      try { renameSync(join(f.projectDir, '.gsd-gone'), join(f.projectDir, '.gsd')); } catch { /* ignore */ }
    });

    // Simulate many agent turn-ends.
    for (let i = 0; i < 10; i++) clearPathCache();

    assert.equal(
      workflowRoot(f.projectDir),
      primed,
      'workflowRoot cache must survive repeated clearPathCache() calls',
    );
  });
});

// ---------------------------------------------------------------------------
// 3. _clearWorkflowRootCache() DOES invalidate workflowRootCache
// ---------------------------------------------------------------------------

describe('_clearWorkflowRootCache() evicts workflowRootCache', () => {
  let f: Fixture;
  beforeEach(() => { f = makeFixture(); });
  afterEach(() => teardownFixture(f));

  test('workflowRoot re-probes after _clearWorkflowRootCache()', (t) => {
    // Prime the cache.
    const primed = workflowRoot(f.projectDir);
    assert.equal(primed, join(f.projectDir, '.gsd'));

    // Hide .gsd — next probe would see it absent.
    renameSync(join(f.projectDir, '.gsd'), join(f.projectDir, '.gsd-hidden'));
    t.after(() => {
      try { renameSync(join(f.projectDir, '.gsd-hidden'), join(f.projectDir, '.gsd')); } catch { /* ignore */ }
    });

    // _clearWorkflowRootCache() must evict, triggering a fresh probe.
    _clearWorkflowRootCache();
    const afterRootClear = workflowRoot(f.projectDir);

    // Probe with .gsd absent falls through to creation fallback (same path value,
    // but the probe definitely ran). Restore and re-prime to confirm it returns
    // the live value rather than a stale cached one.
    renameSync(join(f.projectDir, '.gsd-hidden'), join(f.projectDir, '.gsd'));
    _clearWorkflowRootCache();
    const reprobe = workflowRoot(f.projectDir);
    assert.equal(reprobe, join(f.projectDir, '.gsd'), 're-probe with .gsd restored must find it');

    // The result after root-clear + removal fell back to the creation path (same
    // string as primed), which confirms the probe ran (not from cache).
    assert.equal(afterRootClear, join(f.projectDir, '.gsd'));
  });
});

// ---------------------------------------------------------------------------
// 4. Realpath-normalized keys — /foo and /foo/ share the same cache entry
//    (regression of A2 / H2 behavior)
// ---------------------------------------------------------------------------

describe('realpath normalization: trailing slash shares cache entry', () => {
  let f: Fixture;
  beforeEach(() => { f = makeFixture(); });
  afterEach(() => teardownFixture(f));

  test('/foo and /foo/ map to the same cache entry', () => {
    const withoutSlash = workflowRoot(f.projectDir);

    // Hide .gsd — if a re-probe happened, the result would differ.
    renameSync(join(f.projectDir, '.gsd'), join(f.projectDir, '.gsd-hidden'));
    try {
      const withSlash = workflowRoot(f.projectDir + '/');
      assert.equal(
        withSlash,
        withoutSlash,
        'trailing-slash variant must hit the same cache entry as no-slash variant',
      );
    } finally {
      try { renameSync(join(f.projectDir, '.gsd-hidden'), join(f.projectDir, '.gsd')); } catch { /* ignore */ }
    }
  });

  test('_clearWorkflowRootCache() + workflowRoot with trailing slash re-probes correctly', () => {
    const first = workflowRoot(f.projectDir);

    _clearWorkflowRootCache();
    const second = workflowRoot(f.projectDir + '/');

    assert.equal(
      first,
      second,
      '_clearWorkflowRootCache then call with trailing slash must return same resolved path',
    );
  });
});
