// packages/coworker-memory/src/paste-detector.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectPaste } from './paste-detector.js';

describe('detectPaste', () => {
  it('returns turn for short single-line', () => {
    assert.equal(detectPaste('what servers had alerts last night?'), 'turn');
  });
  it('returns paste when length >= 500', () => {
    assert.equal(detectPaste('x'.repeat(500)), 'paste');
  });
  it('returns paste on triple-backtick fence', () => {
    assert.equal(detectPaste('look at this:\n```ts\nconst x = 1;\n```'), 'paste');
  });
  it('returns paste on > 10 newlines', () => {
    assert.equal(detectPaste('a\n'.repeat(11)), 'paste');
  });
  it('respects custom thresholds', () => {
    assert.equal(detectPaste('x'.repeat(100), { lengthThreshold: 50 }), 'paste');
    assert.equal(detectPaste('a\n'.repeat(5), { newlineThreshold: 3 }), 'paste');
  });
});
