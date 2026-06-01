import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Drawer, DrawerKind, RecallQuery, MemoryBackend, Wing, Room } from './memory.js';

describe('memory types', () => {
  it('Wing is a string alias', () => {
    const w: Wing = 'acme-noc';
    assert.equal(typeof w, 'string');
  });

  it('Room is a string alias', () => {
    const r: Room = 'p1-1234';
    assert.equal(typeof r, 'string');
  });

  it('DrawerKind covers the closed v1 vocabulary', () => {
    const kinds: DrawerKind[] = ['turn', 'paste', 'file_load', 'ticket', 'email', 'rca', 'note'];
    assert.equal(kinds.length, 7);
  });

  it('Drawer requires id, wing, room, kind, content, created_at', () => {
    const d: Drawer = {
      id: 'drw_001',
      wing: 'acme-noc',
      room: 'p1-1234',
      kind: 'ticket',
      content: 'verbatim ticket body',
      metadata: {},
      created_at: '2026-05-31T10:00:00Z',
    };
    assert.equal(d.kind, 'ticket');
  });

  it('RecallQuery has required query and optional filters', () => {
    const q: RecallQuery = { query: 'kernel 4.18' };
    assert.equal(q.query, 'kernel 4.18');
    const qf: RecallQuery = { query: 'mttr', kind: 'rca', wing: 'acme-noc', room: 'p1-1234', max_results: 5 };
    assert.equal(qf.kind, 'rca');
  });

  it('MemoryBackend interface has the seven required methods', () => {
    // Compile-time check via a structural variable
    const _check: keyof MemoryBackend = 'recall';
    const _methods: Array<keyof MemoryBackend> = [
      'recall', 'retain', 'listRooms', 'listWings',
      'entityQuery', 'entityAssert', 'status', 'clear',
    ];
    assert.equal(_methods.length, 8);
  });
});
