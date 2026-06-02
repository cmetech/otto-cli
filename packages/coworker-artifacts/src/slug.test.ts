// packages/coworker-artifacts/src/slug.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveSlug, nextCollisionSlug, MAX_COLLISION_ATTEMPTS } from './slug.js';
import { ArtifactSlugCollision } from './errors.js';

describe('deriveSlug', () => {
  it('lowercases and kebab-cases simple input', () => {
    assert.equal(deriveSlug('RCA: Load Balancer 503'), 'rca-load-balancer-503');
  });
  it('strips non-ASCII and punctuation', () => {
    assert.equal(deriveSlug('résumé — final draft!'), 'resume-final-draft');
  });
  it('collapses runs of dashes', () => {
    assert.equal(deriveSlug('foo --- bar'), 'foo-bar');
  });
  it('trims leading + trailing dashes', () => {
    assert.equal(deriveSlug('---hello---'), 'hello');
  });
  it('truncates to 64 chars', () => {
    const long = 'a'.repeat(100);
    assert.equal(deriveSlug(long).length, 64);
  });
  it('produces fallback for fully-stripped input', () => {
    assert.match(deriveSlug('!!!'), /^artifact-/);
  });
  it('single-char input is preserved', () => {
    assert.equal(deriveSlug('x'), 'x');
  });
});

describe('nextCollisionSlug', () => {
  it('returns -2 on first collision', () => {
    assert.equal(nextCollisionSlug('rca', new Set(['rca'])), 'rca-2');
  });
  it('skips already-taken numeric suffixes', () => {
    assert.equal(nextCollisionSlug('rca', new Set(['rca', 'rca-2', 'rca-3'])), 'rca-4');
  });
  it('throws ArtifactSlugCollision after MAX_COLLISION_ATTEMPTS', () => {
    const taken = new Set<string>(['rca']);
    for (let i = 2; i <= MAX_COLLISION_ATTEMPTS + 1; i++) taken.add(`rca-${i}`);
    assert.throws(() => nextCollisionSlug('rca', taken), ArtifactSlugCollision);
  });
  it('returns base if base not taken', () => {
    assert.equal(nextCollisionSlug('rca', new Set()), 'rca');
  });
});
