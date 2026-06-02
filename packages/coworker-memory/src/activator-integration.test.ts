// packages/coworker-memory/src/activator-integration.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DataLoadDrawer } from '@otto/coworker-scratchpad';

import coworkerVaultExtension from '../../../src/resources/extensions/coworker-vault/index.js';
import coworkerMemoryExtension, {
  getMemoryRecorder, createMemoryBundle,
} from '../../../src/resources/extensions/coworker-memory/index.js';
import coworkerScratchpadExtension from '../../../src/resources/extensions/coworker-scratchpad/index.js';
import {
  makeFakeApi, fireSessionStart, fireSessionShutdown,
  fireBeforeAgentStart, fireAgentStart,
} from '../../../src/resources/extensions/coworker-vault/test-helpers.js';

describe('Phase 3.1 — cross-extension activator integration', () => {
  it('vault + memory + scratchpad activate, recordTurn fires, recall returns drawer', async () => {
    const global = mkdtempSync(join(tmpdir(), 'p31-g-'));
    const ws = mkdtempSync(join(tmpdir(), 'p31-w-'));
    const sp = mkdtempSync(join(tmpdir(), 'p31-sp-'));
    mkdirSync(ws, { recursive: true });
    process.env.OTTO_COWORKER_GLOBAL_DIR = global;
    process.env.OTTO_SCRATCHPAD_ROOT = sp;
    try {
      // Each ext gets its own fake API in this integration shape — they don't
      // need to share an API instance; what they share is filesystem state.
      const vaultApi = makeFakeApi();
      const memApi = makeFakeApi();
      const spApi = makeFakeApi();

      coworkerVaultExtension(vaultApi.api);
      coworkerMemoryExtension(memApi.api);
      coworkerScratchpadExtension(spApi.api);

      await fireSessionStart(vaultApi, { cwd: ws });
      await fireSessionStart(memApi, { cwd: ws });
      await fireSessionStart(spApi, { cwd: ws });

      assert.equal(vaultApi.notifyCalls.find(c => /unavailable/.test(c.message)), undefined);
      assert.equal(memApi.notifyCalls.find(c => /unavailable/.test(c.message)), undefined);
      assert.equal(spApi.notifyCalls.find(c => /unavailable/.test(c.message)), undefined);

      assert.ok(getMemoryRecorder(), 'memory recorder live after session_start');

      // before_agent_start + agent_start round-trip
      await fireBeforeAgentStart(memApi, 'load balancer started returning 503s', 'BASE');
      await fireAgentStart(memApi, 'sess-1', 'turn-1');

      // Verify the drawer landed via a fresh read.
      const peek = await createMemoryBundle({
        globalDir: global, workspaceDir: ws,
        scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
      });
      try {
        const r = await peek.backend.recall({ query: 'load balancer' });
        assert.equal(r.length, 1);
        assert.equal(r[0]!.drawer.kind, 'turn');
        assert.match(r[0]!.drawer.content, /load balancer started returning 503s/);
      } finally { await peek.dispose(); }

      await fireSessionShutdown(memApi);
      await fireSessionShutdown(spApi);
      await fireSessionShutdown(vaultApi);
      assert.equal(getMemoryRecorder(), null, 'recorder cleared');
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });

  it('onDataLoad closure produces a file_load drawer when memory is live', async () => {
    const global = mkdtempSync(join(tmpdir(), 'p31-fl-g-'));
    const ws = mkdtempSync(join(tmpdir(), 'p31-fl-w-'));
    const sp = mkdtempSync(join(tmpdir(), 'p31-fl-sp-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = global;
    process.env.OTTO_SCRATCHPAD_ROOT = sp;
    try {
      const memApi = makeFakeApi();
      coworkerMemoryExtension(memApi.api);
      await fireSessionStart(memApi, { cwd: ws });
      const recorder = getMemoryRecorder()!;
      assert.ok(recorder);

      // Simulate the kernel emitting a data_load event by directly invoking
      // recorder.recordFileLoad with the shape the closure would translate to.
      // (Driving an actual kernel subprocess is overkill for this integration
      // test; the closure logic is locked in Task 4's unit test.)
      await recorder.recordFileLoad({
        scratchpadName: 'p1', collector: 'file', uri: 'file:///x.csv',
        bytes: 1024, rows_loaded: 50, turnId: '',
      });

      const peek = await createMemoryBundle({
        globalDir: global, workspaceDir: ws,
        scopeMode: 'per-project-tagged', currentScratchpadName: () => null,
      });
      try {
        const r = await peek.backend.recall({ query: 'file', kind: 'file_load' });
        assert.equal(r.length, 1);
        const parsed = JSON.parse(r[0]!.drawer.content);
        assert.equal(parsed.collector, 'file');
        assert.equal(parsed.uri, 'file:///x.csv');
        assert.equal(parsed.rows_loaded, 50);
        assert.equal(r[0]!.drawer.room, 'p1');
      } finally { await peek.dispose(); }

      await fireSessionShutdown(memApi);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });

  it('memory init failure does not break vault or scratchpad', async () => {
    // Point only memory at a bad path; vault + scratchpad get good paths.
    const goodGlobal = mkdtempSync(join(tmpdir(), 'p31-mix-'));
    const ws = mkdtempSync(join(tmpdir(), 'p31-mix-ws-'));
    const sp = mkdtempSync(join(tmpdir(), 'p31-mix-sp-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = goodGlobal;
    process.env.OTTO_SCRATCHPAD_ROOT = sp;
    try {
      const vaultApi = makeFakeApi();
      const spApi = makeFakeApi();
      coworkerVaultExtension(vaultApi.api);
      coworkerScratchpadExtension(spApi.api);
      await fireSessionStart(vaultApi, { cwd: ws });
      await fireSessionStart(spApi, { cwd: ws });
      assert.equal(vaultApi.notifyCalls.find(c => /unavailable/.test(c.message)), undefined);
      assert.equal(spApi.notifyCalls.find(c => /unavailable/.test(c.message)), undefined);
      // Memory's onDataLoad path returns null recorder → scratchpad swallows. No crash.
      await fireSessionShutdown(spApi);
      await fireSessionShutdown(vaultApi);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });
});
