import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ArtifactKind, ArtifactHandle, FileWrite, ProvenanceEntry, TurnEntry,
  ArtifactStore,
} from './artifacts.js';

describe('artifacts types', () => {
  it('ArtifactKind is the v1 closed set', () => {
    const kinds: ArtifactKind[] = ['report', 'workbook', 'dataset'];
    assert.equal(kinds.length, 3);
  });

  it('ArtifactHandle carries slug + kind + base path', () => {
    const h: ArtifactHandle = {
      slug: 'rca-p1-1234',
      kind: 'report',
      base_path: '/workspace/.otto/artifacts/rca-p1-1234',
      created_at: '2026-05-31T10:00:00Z',
    };
    assert.equal(h.slug, 'rca-p1-1234');
  });

  it('FileWrite carries relative path + bytes', () => {
    const fw: FileWrite = { path: 'report.md', content: 'hello' };
    assert.equal(fw.path, 'report.md');
  });

  it('ProvenanceEntry has session + turns array', () => {
    const p: ProvenanceEntry = {
      session_id: 'sess_001',
      turns: [],
    };
    assert.equal(p.turns.length, 0);
  });

  it('TurnEntry has turn_id + prompt + files_touched', () => {
    const t: TurnEntry = {
      turn_id: 'turn_001',
      timestamp: '2026-05-31T10:00:00Z',
      prompt_excerpt: 'draft the rca',
      files_touched: ['report.md'],
    };
    assert.equal(t.files_touched[0], 'report.md');
  });

  it('ArtifactStore has create/update/recordTurn signatures', () => {
    const _check: keyof ArtifactStore = 'create';
    const _methods: Array<keyof ArtifactStore> = ['create', 'update', 'recordTurn', 'get', 'list'];
    assert.equal(_methods.length, 5);
  });
});
