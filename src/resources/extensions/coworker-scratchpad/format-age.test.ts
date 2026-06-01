import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatRelativeAge } from './format-age.js';

describe('formatRelativeAge', () => {
  it('returns "active" for ages under 30s', () => {
    assert.equal(formatRelativeAge(0), 'active');
    assert.equal(formatRelativeAge(15_000), 'active');
    assert.equal(formatRelativeAge(29_999), 'active');
  });

  it('returns "idle Xm" for ages 30s–1h (floored minutes)', () => {
    assert.equal(formatRelativeAge(30_000), 'idle 0m');
    assert.equal(formatRelativeAge(60_000), 'idle 1m');
    assert.equal(formatRelativeAge(30 * 60_000), 'idle 30m');
    assert.equal(formatRelativeAge(59 * 60_000 + 59_000), 'idle 59m');
  });

  it('returns "idle Xh" for ages 1h–24h (floored hours)', () => {
    assert.equal(formatRelativeAge(60 * 60_000), 'idle 1h');
    assert.equal(formatRelativeAge(2 * 60 * 60_000 + 30 * 60_000), 'idle 2h');
    assert.equal(formatRelativeAge(23 * 60 * 60_000 + 59 * 60_000), 'idle 23h');
  });

  it('returns "idle Xd" for ages 24h+ (floored days)', () => {
    assert.equal(formatRelativeAge(24 * 60 * 60_000), 'idle 1d');
    assert.equal(formatRelativeAge(7 * 24 * 60 * 60_000), 'idle 7d');
    assert.equal(formatRelativeAge(30 * 24 * 60 * 60_000 + 5 * 60 * 60_000), 'idle 30d');
  });
});
