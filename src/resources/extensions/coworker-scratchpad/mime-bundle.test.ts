import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveMimeBundle } from './mime-bundle.js';

describe('deriveMimeBundle', () => {
  it('returns an empty bundle when value is undefined and stdout is empty', () => {
    assert.deepEqual(deriveMimeBundle(undefined, ''), {});
  });

  it('returns only text/plain when stdout is non-empty and value is undefined', () => {
    const b = deriveMimeBundle(undefined, 'hello\nworld');
    assert.deepEqual(b, { 'text/plain': 'hello\nworld' });
  });

  it('returns only application/json when value is a number and stdout is empty', () => {
    assert.deepEqual(deriveMimeBundle(42, ''), { 'application/json': 42 });
  });

  it('drops application/json when value is null', () => {
    assert.deepEqual(deriveMimeBundle(null, 'log'), { 'text/plain': 'log' });
  });

  it('returns text/plain AND application/json when both present', () => {
    assert.deepEqual(deriveMimeBundle({ rows: 3 }, 'loaded'), {
      'text/plain': 'loaded',
      'application/json': { rows: 3 },
    });
  });

  it('adds text/markdown when value is a string starting with # (heading)', () => {
    const b = deriveMimeBundle('# Title\n\nbody', '');
    assert.equal(b['application/json'], '# Title\n\nbody');
    assert.equal(b['text/markdown'], '# Title\n\nbody');
  });

  it('adds text/markdown when value is a string starting with | (table)', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |';
    const b = deriveMimeBundle(md, '');
    assert.equal(b['text/markdown'], md);
  });

  it('adds text/markdown when value contains a GFM table separator row mid-string', () => {
    const md = 'preamble\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
    const b = deriveMimeBundle(md, '');
    assert.equal(b['text/markdown'], md);
  });

  it('does NOT add text/markdown for plain prose strings', () => {
    const b = deriveMimeBundle('just a sentence', '');
    assert.equal(b['application/json'], 'just a sentence');
    assert.equal(b['text/markdown'], undefined);
  });

  it('keeps the value in application/json when also tagged markdown', () => {
    // A future LLM consumer that always reads application/json must not lose data
    // just because the string looked markdown-shaped.
    const b = deriveMimeBundle('# h', '');
    assert.equal(b['application/json'], '# h');
    assert.equal(b['text/markdown'], '# h');
  });
});
