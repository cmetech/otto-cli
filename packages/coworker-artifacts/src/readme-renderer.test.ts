// packages/coworker-artifacts/src/readme-renderer.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderReadme } from './readme-renderer.js';
import type { ArtifactMetadata, Provenance } from './types.js';

const META: ArtifactMetadata = {
  _schema: 1,
  slug: 'rca-1',
  kind: 'report',
  name: 'RCA: load balancer 503',
  created_at: '2026-06-02T14:32:00Z',
  last_updated_at: '2026-06-02T15:18:00Z',
  turn_count: 2,
  primary_file: 'report.md',
  uri: 'artifact://rca-1',
};

const PROV: Provenance = [
  {
    _schema: 1, ts: '2026-06-02T14:32:00Z', action: 'create',
    turn_id: 'turn-abc', agent_turn_id: 'agent-xyz',
    user_prompt: 'draft the RCA', scratchpad_name: 'p1',
    files_touched: ['report.md'],
  },
  {
    _schema: 1, ts: '2026-06-02T15:18:00Z', action: 'update',
    turn_id: 'turn-def', user_prompt: 'add timeline',
    scratchpad_name: 'p1', files_touched: ['report.md'],
  },
];

describe('renderReadme', () => {
  it('renders header with name + uri + dates + turn count', () => {
    const md = renderReadme(META, PROV, [{ path: 'report.md', sizeBytes: 4200 }]);
    assert.match(md, /^# RCA: load balancer 503/m);
    assert.match(md, /\*\*Kind:\*\* report/);
    assert.match(md, /\*\*URI:\*\* `artifact:\/\/rca-1`/);
    assert.match(md, /\*\*Created:\*\* 2026-06-02T14:32:00Z/);
    assert.match(md, /\*\*Last updated:\*\* 2026-06-02T15:18:00Z/);
    assert.match(md, /\*\*Turns:\*\* 2/);
  });
  it('renders files section with human-readable sizes', () => {
    const md = renderReadme(META, PROV, [{ path: 'report.md', sizeBytes: 4200 }]);
    assert.match(md, /## Files/);
    assert.match(md, /`report.md` — 4\.1 KB/);
  });
  it('renders provenance table', () => {
    const md = renderReadme(META, PROV, [{ path: 'report.md', sizeBytes: 4200 }]);
    assert.match(md, /## Provenance/);
    assert.match(md, /\| # \| ts \| action \| turn \| prompt \|/);
    assert.match(md, /\| 1 \| 2026-06-02T14:32:00Z \| create \| turn-abc \| draft the RCA \|/);
    assert.match(md, /\| 2 \| 2026-06-02T15:18:00Z \| update \| turn-def \| add timeline \|/);
  });
  it('is deterministic — same inputs produce byte-identical output', () => {
    const a = renderReadme(META, PROV, [{ path: 'report.md', sizeBytes: 4200 }]);
    const b = renderReadme(META, PROV, [{ path: 'report.md', sizeBytes: 4200 }]);
    assert.equal(a, b);
  });
  it('handles empty provenance', () => {
    const md = renderReadme(META, [], [{ path: 'report.md', sizeBytes: 0 }]);
    assert.match(md, /## Provenance/);
    // No table rows beyond header
    const tableRows = (md.match(/^\| \d+ \|/gm) ?? []).length;
    assert.equal(tableRows, 0);
  });
  it('handles empty file stats', () => {
    const md = renderReadme(META, PROV, []);
    assert.match(md, /## Files/);
    assert.match(md, /\(none\)/);
  });
});
