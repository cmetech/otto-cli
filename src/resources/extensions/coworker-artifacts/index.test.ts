// src/resources/extensions/coworker-artifacts/index.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import coworkerArtifactsExtension, { getArtifactStore } from './index.js';
import { makeFakeApi, fireSessionStart, fireSessionShutdown } from '../coworker-vault/test-helpers.js';

describe('coworker-artifacts activator', () => {
  it('barrel exports key surface', () => {
    assert.equal(typeof coworkerArtifactsExtension, 'function');
    assert.equal(typeof getArtifactStore, 'function');
  });
  it('getArtifactStore is null before session_start', () => {
    assert.equal(getArtifactStore(), null);
  });
  it('registers list_artifacts + open_artifact tools and /artifacts command', () => {
    const api = makeFakeApi();
    coworkerArtifactsExtension(api.api);
    assert.ok(api.tools.has('list_artifacts'));
    assert.ok(api.tools.has('open_artifact'));
    assert.ok(api.commands.has('artifacts'));
  });
  it('session_start constructs bundle and getArtifactStore returns store', async () => {
    const api = makeFakeApi();
    coworkerArtifactsExtension(api.api);
    const ws = mkdtempSync(join(tmpdir(), 'art-act-'));
    await fireSessionStart(api, { cwd: ws });
    assert.equal(api.notifyCalls.find((c) => /unavailable/.test(c.message)), undefined);
    assert.ok(getArtifactStore());
    await fireSessionShutdown(api);
    assert.equal(getArtifactStore(), null);
  });
  it('command gates on bundle and notifies "not ready" when session_start never fires', async () => {
    // ArtifactStore is lazy — its constructor doesn't fail even on an empty
    // workspaceDir. The intended assertion of this test is the GATING path:
    // a fresh activator whose session_start was never fired must respond to
    // /artifacts with a "not ready" notify rather than crashing.
    const fresh = makeFakeApi();
    coworkerArtifactsExtension(fresh.api);
    const cmd = fresh.commands.get('artifacts')!;
    await cmd.handler('list', fresh.commandCtx);
    assert.ok(fresh.notifyCalls.find((c) => /not ready/.test(c.message)));
  });
});
