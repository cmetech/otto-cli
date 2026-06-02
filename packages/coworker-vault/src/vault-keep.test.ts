import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VAULT_KEEP, mergeWithSentinel, assertNoSentinelInCreate } from './vault-keep.js';
import type { EngineField } from './types.js';

const FIELDS: EngineField[] = [
  { name: 'url',   label: 'URL',   secret: false, required: true },
  { name: 'token', label: 'Token', secret: true,  required: true },
  { name: 'email', label: 'Email', secret: false, required: false },
];

describe('VAULT_KEEP', () => {
  it('is the literal string "[VAULT_KEEP]"', () => {
    assert.equal(VAULT_KEEP, '[VAULT_KEEP]');
  });

  describe('mergeWithSentinel (edit mode)', () => {
    it('preserves stored secret when submitted value is the sentinel', () => {
      const stored = { url: 'https://old', token: 'SECRET', email: 'a@b' };
      const submitted = { url: 'https://new', token: VAULT_KEEP, email: 'c@d' };
      const out = mergeWithSentinel(FIELDS, stored, submitted);
      assert.deepEqual(out, { url: 'https://new', token: 'SECRET', email: 'c@d' });
    });

    it('replaces stored secret when submitted value differs from the sentinel', () => {
      const stored = { url: 'u', token: 'OLD', email: 'e' };
      const submitted = { url: 'u', token: 'NEW', email: 'e' };
      const out = mergeWithSentinel(FIELDS, stored, submitted);
      assert.equal(out.token, 'NEW');
    });

    it('ignores sentinel for non-secret fields (treats it as literal new value)', () => {
      const stored = { url: 'u', token: 't', email: 'e' };
      const submitted = { url: VAULT_KEEP, token: 't', email: 'e' };
      const out = mergeWithSentinel(FIELDS, stored, submitted);
      assert.equal(out.url, VAULT_KEEP);
    });
  });

  describe('assertNoSentinelInCreate', () => {
    it('throws when a secret field input equals the sentinel', () => {
      assert.throws(() => assertNoSentinelInCreate(FIELDS, { url: 'u', token: VAULT_KEEP, email: 'e' }), /VAULT_KEEP is reserved/);
    });

    it('passes when no secret field equals the sentinel', () => {
      assert.doesNotThrow(() => assertNoSentinelInCreate(FIELDS, { url: 'u', token: 'real', email: 'e' }));
    });
  });
});
