import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatRecall } from './recall-formatter.js';

describe('formatRecall', () => {
  it('returns empty header for zero results', () => {
    const md = formatRecall([]);
    assert.match(md, /### Memory recall \(0 matches\)/);
    assert.equal(md.includes('drawer://'), false);
  });
  it('renders match metadata + snippet + drawer URI', () => {
    const md = formatRecall([{
      drawer: {
        id: 'abc123', wing: 'global', room: 'inbox', kind: 'paste',
        content: 'full content', metadata: {}, created_at: '2026-06-01T14:22:00Z',
        redacted: false,
      },
      score: 5.21, snippet: 'paste content <mark>matched</mark> terms',
    }]);
    assert.match(md, /\[global\/inbox\/paste · 2026-06-01 14:22\] \(score 5\.21\)/);
    assert.match(md, /<mark>matched<\/mark>/);
    assert.match(md, /drawer:\/\/abc123/);
  });
  it('flags redacted drawers', () => {
    const md = formatRecall([{
      drawer: {
        id: 'r1', wing: 'g', room: 'inbox', kind: 'paste', content: 'x',
        metadata: {}, created_at: '2026-06-01T00:00:00Z', redacted: true,
      },
      score: 1, snippet: 'x',
    }]);
    assert.match(md, /\(redacted\)/);
  });
});
