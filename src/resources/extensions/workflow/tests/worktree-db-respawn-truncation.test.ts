/**
 * worktree-db-respawn-truncation.test.ts — Regression test for #2815.
 *
 * Verifies that syncProjectRootToWorktree does NOT delete a non-empty
 * worktree otto.db. On worker respawn, gsd-migrate populates the DB
 * (~1.7MB) before the auto-loop calls syncProjectRootToWorktree. The
 * sync step must preserve the freshly-migrated DB to avoid truncating
 * it to 0 bytes and causing "no such table: slices" failures.
 *
 * Covers:
 *   - Non-empty worktree otto.db preserved after sync (#2815)
 *   - Empty (0-byte) worktree otto.db still deleted (#853 preserved)
 *   - WAL/SHM sidecar files cleaned up when empty DB is deleted
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { syncProjectRootToWorktree } from '../auto-worktree.ts';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';


function createBase(name: string): string {
  const base = mkdtempSync(join(tmpdir(), `gsd-wt-respawn-${name}-`));
  mkdirSync(join(base, '.otto/workflow', 'milestones'), { recursive: true });
  return base;
}

function cleanup(base: string): void {
  rmSync(base, { recursive: true, force: true });
}

describe('worktree-db-respawn-truncation (#2815)', async () => {

  // ─── 1. Non-empty worktree otto.db preserved after sync ───────────────
  console.log('\n=== 1. non-empty worktree otto.db preserved after sync (#2815) ===');
  {
    const mainBase = createBase('main');
    const wtBase = createBase('wt');

    try {
      // Set up milestone artifacts in main project root
      const m001Dir = join(mainBase, '.otto/workflow', 'milestones', 'M001');
      mkdirSync(m001Dir, { recursive: true });
      writeFileSync(join(m001Dir, 'M001-ROADMAP.md'), '# Roadmap');

      // Simulate a freshly-migrated worktree DB (non-empty, like after gsd-migrate)
      // Real DBs are ~1.7MB; we use a smaller payload to prove the size check works
      const fakeDbContent = Buffer.alloc(4096, 0x42); // 4KB non-empty DB
      writeFileSync(join(wtBase, '.otto/workflow', 'otto.db'), fakeDbContent);

      const sizeBefore = statSync(join(wtBase, '.otto/workflow', 'otto.db')).size;
      assert.ok(sizeBefore > 0, 'otto.db is non-empty before sync');

      syncProjectRootToWorktree(mainBase, wtBase, 'M001');

      // The non-empty DB must survive the sync
      assert.ok(
        existsSync(join(wtBase, '.otto/workflow', 'otto.db')),
        '#2815: non-empty otto.db must not be deleted by sync',
      );
      const sizeAfter = statSync(join(wtBase, '.otto/workflow', 'otto.db')).size;
      assert.equal(
        sizeAfter,
        sizeBefore,
        '#2815: otto.db size must be unchanged after sync',
      );
    } finally {
      cleanup(mainBase);
      cleanup(wtBase);
    }
  }

  // ─── 2. Empty (0-byte) worktree otto.db still deleted ─────────────────
  console.log('\n=== 2. empty (0-byte) worktree otto.db still deleted (#853) ===');
  {
    const mainBase = createBase('main');
    const wtBase = createBase('wt');

    try {
      const m001Dir = join(mainBase, '.otto/workflow', 'milestones', 'M001');
      mkdirSync(m001Dir, { recursive: true });
      writeFileSync(join(m001Dir, 'M001-ROADMAP.md'), '# Roadmap');

      // Create an empty (0-byte) otto.db — this is stale/corrupt and should be deleted
      writeFileSync(join(wtBase, '.otto/workflow', 'otto.db'), '');
      assert.ok(existsSync(join(wtBase, '.otto/workflow', 'otto.db')), 'empty otto.db exists before sync');

      syncProjectRootToWorktree(mainBase, wtBase, 'M001');

      assert.ok(
        !existsSync(join(wtBase, '.otto/workflow', 'otto.db')),
        '#853: empty otto.db must still be deleted after sync',
      );
    } finally {
      cleanup(mainBase);
      cleanup(wtBase);
    }
  }

  // ─── 3. WAL/SHM sidecar files cleaned up when empty DB is deleted (#2478) ──
  console.log('\n=== 3. orphaned WAL/SHM cleaned up alongside empty otto.db (#2478) ===');
  {
    const mainBase = createBase('main');
    const wtBase = createBase('wt');

    try {
      const m001Dir = join(mainBase, '.otto/workflow', 'milestones', 'M001');
      mkdirSync(m001Dir, { recursive: true });
      writeFileSync(join(m001Dir, 'M001-ROADMAP.md'), '# Roadmap');

      // Create an empty (0-byte) otto.db plus orphaned WAL and SHM files —
      // this is the exact state that causes Node 24 node:sqlite CPU spin (#2478).
      const wtGsd = join(wtBase, '.otto/workflow');
      writeFileSync(join(wtGsd, 'otto.db'), '');
      writeFileSync(join(wtGsd, 'otto.db-wal'), Buffer.alloc(605672, 0xAA));
      writeFileSync(join(wtGsd, 'otto.db-shm'), Buffer.alloc(32768, 0xBB));

      assert.ok(existsSync(join(wtGsd, 'otto.db')), 'otto.db exists before sync');
      assert.ok(existsSync(join(wtGsd, 'otto.db-wal')), 'otto.db-wal exists before sync');
      assert.ok(existsSync(join(wtGsd, 'otto.db-shm')), 'otto.db-shm exists before sync');

      syncProjectRootToWorktree(mainBase, wtBase, 'M001');

      assert.ok(
        !existsSync(join(wtGsd, 'otto.db')),
        '#2478: empty otto.db must be deleted',
      );
      assert.ok(
        !existsSync(join(wtGsd, 'otto.db-wal')),
        '#2478: orphaned otto.db-wal must be deleted alongside otto.db',
      );
      assert.ok(
        !existsSync(join(wtGsd, 'otto.db-shm')),
        '#2478: orphaned otto.db-shm must be deleted alongside otto.db',
      );
    } finally {
      cleanup(mainBase);
      cleanup(wtBase);
    }
  }

  // ─── 4. Orphaned WAL/SHM cleaned up even when otto.db already missing (#2478) ──
  console.log('\n=== 4. orphaned WAL/SHM cleaned up even without otto.db (#2478) ===');
  {
    const mainBase = createBase('main');
    const wtBase = createBase('wt');

    try {
      const m001Dir = join(mainBase, '.otto/workflow', 'milestones', 'M001');
      mkdirSync(m001Dir, { recursive: true });
      writeFileSync(join(m001Dir, 'M001-ROADMAP.md'), '# Roadmap');

      // Orphaned WAL/SHM with NO otto.db at all — can happen from a previous
      // partial cleanup. These must still be cleaned up.
      const wtGsd = join(wtBase, '.otto/workflow');
      writeFileSync(join(wtGsd, 'otto.db-wal'), Buffer.alloc(1024, 0xAA));
      writeFileSync(join(wtGsd, 'otto.db-shm'), Buffer.alloc(1024, 0xBB));

      assert.ok(!existsSync(join(wtGsd, 'otto.db')), 'otto.db does not exist');
      assert.ok(existsSync(join(wtGsd, 'otto.db-wal')), 'orphaned otto.db-wal exists');
      assert.ok(existsSync(join(wtGsd, 'otto.db-shm')), 'orphaned otto.db-shm exists');

      syncProjectRootToWorktree(mainBase, wtBase, 'M001');

      assert.ok(
        !existsSync(join(wtGsd, 'otto.db-wal')),
        '#2478: orphaned otto.db-wal must be deleted even without main db file',
      );
      assert.ok(
        !existsSync(join(wtGsd, 'otto.db-shm')),
        '#2478: orphaned otto.db-shm must be deleted even without main db file',
      );
    } finally {
      cleanup(mainBase);
      cleanup(wtBase);
    }
  }

  // ─── 5. Milestone artifacts still synced when DB is preserved ────────
  console.log('\n=== 5. milestone artifacts still synced even when DB preserved ===');
  {
    const mainBase = createBase('main');
    const wtBase = createBase('wt');

    try {
      const m001Dir = join(mainBase, '.otto/workflow', 'milestones', 'M001');
      mkdirSync(m001Dir, { recursive: true });
      writeFileSync(join(m001Dir, 'M001-ROADMAP.md'), '# Roadmap');
      mkdirSync(join(m001Dir, 'slices', 'S01'), { recursive: true });
      writeFileSync(join(m001Dir, 'slices', 'S01', 'S01-PLAN.md'), '# Plan');

      // Non-empty DB in worktree
      writeFileSync(join(wtBase, '.otto/workflow', 'otto.db'), 'populated-db-data');

      syncProjectRootToWorktree(mainBase, wtBase, 'M001');

      // Artifacts must still be synced
      assert.ok(
        existsSync(join(wtBase, '.otto/workflow', 'milestones', 'M001', 'M001-ROADMAP.md')),
        'milestone artifacts synced even with preserved DB',
      );
      assert.ok(
        existsSync(join(wtBase, '.otto/workflow', 'milestones', 'M001', 'slices', 'S01', 'S01-PLAN.md')),
        'slice artifacts synced even with preserved DB',
      );
      // DB must still exist
      assert.ok(
        existsSync(join(wtBase, '.otto/workflow', 'otto.db')),
        '#2815: DB preserved alongside artifact sync',
      );
    } finally {
      cleanup(mainBase);
      cleanup(wtBase);
    }
  }
});
