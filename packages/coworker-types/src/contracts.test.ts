import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MemoryRecorder, RecordEpisodeArgs, RecordCellArgs, AccEventArgs } from './contracts.js';

describe('inter-package contracts', () => {
  it('RecordEpisodeArgs uses DrawerKind enum, not free string', () => {
    const args: RecordEpisodeArgs = {
      sessionId: 'sess_001',
      room: 'p1-1234',
      kind: 'ticket',     // must compile only because 'ticket' is a DrawerKind
      content: 'verbatim',
      turnId: 'turn_001',
    };
    assert.equal(args.kind, 'ticket');
  });

  it('RecordCellArgs has scratchpadName + cellId + duration', () => {
    const args: RecordCellArgs = {
      scratchpadName: 'p1-1234',
      cellId: 'cell_001',
      code: 'const x = 1;',
      stdout: '',
      error: null,
      durationMs: 42,
    };
    assert.equal(args.durationMs, 42);
  });

  it('AccEventArgs has kind + detail + severity', () => {
    const args: AccEventArgs = {
      sessionId: 'sess_001',
      kind: 'repeated_error_signature',
      detail: 'UnicodeDecodeError x4',
      severity: 'medium',
    };
    assert.equal(args.severity, 'medium');
  });

  it('MemoryRecorder has the three required methods', () => {
    const _methods: Array<keyof MemoryRecorder> = ['recordEpisode', 'recordCell', 'observeAccEvent'];
    assert.equal(_methods.length, 3);
  });
});
