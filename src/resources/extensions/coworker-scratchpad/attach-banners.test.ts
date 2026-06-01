import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { showRecoveryNotesBanner, showDivergenceBanner } from './attach-banners.js';

interface FakeUi {
  notifications: Array<[string, string]>;
  notify: (msg: string, level: 'info' | 'warning' | 'error') => void;
}

function makeUi(): FakeUi {
  const notifications: FakeUi['notifications'] = [];
  return { notifications, notify: (m, l) => notifications.push([l, m]) };
}

function writeMeta(root: string, name: string, meta: Record<string, unknown>): void {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, 'meta.json'), JSON.stringify(meta));
}

let root: string;

describe('attach-banners', () => {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'banners-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('showRecoveryNotesBanner emits warning when there are unseen notes; returns markSeen=true', () => {
    writeMeta(root, 'p1', {
      recovery_notes: [
        { kind: 'snapshot-failed', message: 'boom', at: '2026-05-31T10:00:00.000Z' },
        { kind: 'cells-since-snapshot', n: 3, at: '2026-05-31T11:00:00.000Z' },
      ],
      recovery_notes_seen_at: null,
    });
    const ui = makeUi();
    const { unseenCount, markSeen } = showRecoveryNotesBanner('p1', root, ui);
    assert.equal(unseenCount, 2);
    assert.equal(markSeen, true);
    assert.equal(ui.notifications.length, 1);
    assert.equal(ui.notifications[0][0], 'warning');
    assert.match(ui.notifications[0][1], /2 unread recovery notes/);
    assert.match(ui.notifications[0][1], /snapshot-failed: boom/);
    assert.match(ui.notifications[0][1], /3 cells since last snapshot/);
  });

  it('showRecoveryNotesBanner does not notify when all notes are seen; returns markSeen=false', () => {
    writeMeta(root, 'p1', {
      recovery_notes: [
        { kind: 'snapshot-failed', message: 'boom', at: '2026-05-31T10:00:00.000Z' },
      ],
      recovery_notes_seen_at: '2026-05-31T11:00:00.000Z',
    });
    const ui = makeUi();
    const { unseenCount, markSeen } = showRecoveryNotesBanner('p1', root, ui);
    assert.equal(unseenCount, 0);
    assert.equal(markSeen, false);
    assert.equal(ui.notifications.length, 0);
  });

  it('showRecoveryNotesBanner truncates to 5 with "+ N more" footer', () => {
    const notes = Array.from({ length: 8 }, (_, i) => ({
      kind: 'snapshot-failed' as const,
      message: `err-${i}`,
      at: `2026-05-31T1${i}:00:00.000Z`,
    }));
    writeMeta(root, 'p1', { recovery_notes: notes, recovery_notes_seen_at: null });
    const ui = makeUi();
    const { unseenCount } = showRecoveryNotesBanner('p1', root, ui);
    assert.equal(unseenCount, 8);
    assert.match(ui.notifications[0][1], /\+ 3 more \(run \/sp notes\)/);
    // Should include err-0..err-4 (first 5) but not err-5..err-7
    assert.match(ui.notifications[0][1], /err-0/);
    assert.match(ui.notifications[0][1], /err-4/);
    assert.equal(ui.notifications[0][1].includes('err-5'), false);
  });

  it('showRecoveryNotesBanner tolerates missing or corrupt meta silently', () => {
    const ui = makeUi();
    // Missing scratchpad dir
    const r1 = showRecoveryNotesBanner('absent', root, ui);
    assert.deepEqual(r1, { unseenCount: 0, markSeen: false });
    // Corrupt meta.json
    mkdirSync(join(root, 'p2'), { recursive: true });
    writeFileSync(join(root, 'p2', 'meta.json'), '{not json');
    const r2 = showRecoveryNotesBanner('p2', root, ui);
    assert.deepEqual(r2, { unseenCount: 0, markSeen: false });
    assert.equal(ui.notifications.length, 0);
  });

  it('showDivergenceBanner emits info when leaf !== kernel; both set', () => {
    writeMeta(root, 'p1', { cell_leaf_id: 5, kernel_at_cell_id: 8 });
    const ui = makeUi();
    const { diverged } = showDivergenceBanner('p1', root, ui);
    assert.equal(diverged, true);
    assert.equal(ui.notifications.length, 1);
    assert.equal(ui.notifications[0][0], 'info');
    assert.match(ui.notifications[0][1], /kernel state is at cell #8/);
    assert.match(ui.notifications[0][1], /view is at cell #5/);
    assert.match(ui.notifications[0][1], /\/sp tree to inspect/);
  });

  it('showDivergenceBanner does not notify when leaf===kernel, either is null, or meta missing', () => {
    const ui = makeUi();
    // Equal
    writeMeta(root, 'p1', { cell_leaf_id: 5, kernel_at_cell_id: 5 });
    assert.deepEqual(showDivergenceBanner('p1', root, ui), { diverged: false });
    // Leaf null
    writeMeta(root, 'p2', { cell_leaf_id: null, kernel_at_cell_id: 5 });
    assert.deepEqual(showDivergenceBanner('p2', root, ui), { diverged: false });
    // Kernel null
    writeMeta(root, 'p3', { cell_leaf_id: 5, kernel_at_cell_id: null });
    assert.deepEqual(showDivergenceBanner('p3', root, ui), { diverged: false });
    // Meta missing
    assert.deepEqual(showDivergenceBanner('absent', root, ui), { diverged: false });
    assert.equal(ui.notifications.length, 0);
  });
});
