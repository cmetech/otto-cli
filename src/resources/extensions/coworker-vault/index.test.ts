// src/resources/extensions/coworker-vault/index.test.ts
//
// Unit tests for the coworker-vault production activator.
// Verifies command registration, session_start/shutdown lifecycle, init-failure
// gating, and that the /connect handler doesn't surface "unavailable" on a happy
// session_start.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import coworkerVaultExtension from './index.js';
import { makeFakeApi, fireSessionStart, fireSessionShutdown } from './test-helpers.js';

describe('coworker-vault activator', () => {
  it('registers /connect, /datasource, /audit commands at load time', () => {
    const api = makeFakeApi();
    coworkerVaultExtension(api.api);
    assert.ok(api.commands.has('connect'), 'connect command registered');
    assert.ok(api.commands.has('datasource'), 'datasource command registered');
    assert.ok(api.commands.has('audit'), 'audit command registered');
  });

  it('session_start constructs bundle; session_shutdown clears it', async () => {
    const api = makeFakeApi();
    coworkerVaultExtension(api.api);
    const ws = mkdtempSync(join(tmpdir(), 'vault-act-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = mkdtempSync(join(tmpdir(), 'otto-global-'));
    try {
      await fireSessionStart(api, { cwd: ws });
      assert.equal(
        api.notifyCalls.filter(c => /unavailable/.test(c.message)).length,
        0,
        'no failure notify on happy path',
      );
      await fireSessionShutdown(api);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
    }
  });

  it('init failure notifies + leaves commands registered (handlers gate on bundle)', async () => {
    const api = makeFakeApi();
    coworkerVaultExtension(api.api);
    // Force createVaultBundle to fail by pointing at a non-writable path.
    process.env.OTTO_COWORKER_GLOBAL_DIR = '/no/such/path/should/not/exist';
    try {
      await fireSessionStart(api, { cwd: '/tmp' });
      const warn = api.notifyCalls.find(c => c.level === 'warning');
      assert.ok(warn, 'expected a warning notify');
      assert.match(warn!.message, /vault unavailable/);
      // Calling the connect handler should notify "vault unavailable" and not throw.
      const connect = api.commands.get('connect')!;
      await connect.handler('', api.commandCtx);
      const unavail = api.notifyCalls.filter(c => /unavailable/.test(c.message));
      assert.ok(unavail.length >= 2, `expected ≥2 unavailable notices, got ${unavail.length}`);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
    }
  });

  it('happy path: /connect handler runs without unavailable notice', async () => {
    const api = makeFakeApi();
    coworkerVaultExtension(api.api);
    const ws = mkdtempSync(join(tmpdir(), 'vault-conn-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = mkdtempSync(join(tmpdir(), 'otto-conn-'));
    try {
      await fireSessionStart(api, { cwd: ws });
      const connect = api.commands.get('connect')!;
      await connect.handler('', api.commandCtx);
      // No "unavailable" notice should be emitted on a successful session_start;
      // /connect may emit a usage notice (info), which is acceptable.
      assert.equal(
        api.notifyCalls.find(c => /unavailable/.test(c.message)),
        undefined,
        'no "unavailable" notice expected when bundle is healthy',
      );
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
    }
  });
});
