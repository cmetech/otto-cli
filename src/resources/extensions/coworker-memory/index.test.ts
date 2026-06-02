// src/resources/extensions/coworker-memory/index.test.ts
//
// Unit tests for the coworker-memory production activator.
// Covers barrel surface preservation (replaces the Phase 3 Task 12 spot-check
// stub), lifecycle wiring (session_start/shutdown), command + tool registration,
// before_agent_start + agent_start round-trip recording a turn drawer,
// Layer A context injection, and init-failure gating.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import coworkerMemoryExtension, { getMemoryRecorder, createMemoryBundle } from './index.js';
import {
  makeFakeApi, fireSessionStart, fireSessionShutdown,
  fireBeforeAgentStart, fireAgentStart,
} from '../coworker-vault/test-helpers.js';

describe('coworker-memory activator', () => {
  it('barrel still exports key surface (preserves Task 12 spot-check)', () => {
    assert.equal(typeof createMemoryBundle, 'function');
    assert.equal(typeof getMemoryRecorder, 'function');
    assert.equal(typeof coworkerMemoryExtension, 'function');
  });

  it('getMemoryRecorder returns null before session_start', () => {
    assert.equal(getMemoryRecorder(), null);
  });

  it('registers memorize + recall tools and /memory command', () => {
    const api = makeFakeApi();
    coworkerMemoryExtension(api.api);
    assert.ok(api.tools.has('memorize'));
    assert.ok(api.tools.has('recall'));
    assert.ok(api.commands.has('memory'));
  });

  it('session_start constructs bundle; getMemoryRecorder returns recorder', async () => {
    const api = makeFakeApi();
    coworkerMemoryExtension(api.api);
    const ws = mkdtempSync(join(tmpdir(), 'mem-act-'));
    const global = mkdtempSync(join(tmpdir(), 'mem-act-global-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = global;
    process.env.OTTO_SCRATCHPAD_ROOT = mkdtempSync(join(tmpdir(), 'mem-act-sp-'));
    try {
      await fireSessionStart(api, { cwd: ws });
      assert.equal(api.notifyCalls.find(c => /unavailable/.test(c.message)), undefined);
      assert.ok(getMemoryRecorder(), 'recorder should be set after session_start');
      await fireSessionShutdown(api);
      assert.equal(getMemoryRecorder(), null, 'recorder cleared after session_shutdown');
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });

  it('before_agent_start + agent_start round-trip records a turn drawer', async () => {
    const api = makeFakeApi();
    coworkerMemoryExtension(api.api);
    const ws = mkdtempSync(join(tmpdir(), 'mem-rt-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = mkdtempSync(join(tmpdir(), 'mem-rt-g-'));
    process.env.OTTO_SCRATCHPAD_ROOT = mkdtempSync(join(tmpdir(), 'mem-rt-sp-'));
    try {
      await fireSessionStart(api, { cwd: ws });
      const result = await fireBeforeAgentStart(api, 'what happened last night', 'YOU ARE OTTO');
      // No Layer A content yet → no augmentation expected.
      assert.equal(result?.systemPrompt, undefined);
      await fireAgentStart(api, 'sess-1', 'turn-1');
      // Verify via a fresh peek bundle reading the same DB.
      const peek = await createMemoryBundle({
        globalDir: process.env.OTTO_COWORKER_GLOBAL_DIR!,
        workspaceDir: ws,
        scopeMode: 'per-project-tagged',
        currentScratchpadName: () => null,
      });
      try {
        const results = await peek.backend.recall({ query: 'happened' });
        assert.equal(results.length, 1);
        assert.equal(results[0]!.drawer.kind, 'turn');
        assert.match(results[0]!.drawer.content, /what happened last night/);
      } finally {
        await peek.dispose();
      }
      await fireSessionShutdown(api);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });

  it('before_agent_start injects Layer A block when Layer A has content', async () => {
    const api = makeFakeApi();
    coworkerMemoryExtension(api.api);
    const ws = mkdtempSync(join(tmpdir(), 'mem-la-'));
    process.env.OTTO_COWORKER_GLOBAL_DIR = mkdtempSync(join(tmpdir(), 'mem-la-g-'));
    process.env.OTTO_SCRATCHPAD_ROOT = mkdtempSync(join(tmpdir(), 'mem-la-sp-'));
    try {
      await fireSessionStart(api, { cwd: ws });
      // Seed a lesson into the workspace Layer A store through a fresh bundle.
      const seed = await createMemoryBundle({
        globalDir: process.env.OTTO_COWORKER_GLOBAL_DIR!,
        workspaceDir: ws, scopeMode: 'per-project-tagged',
        currentScratchpadName: () => null,
      });
      try {
        await seed.workspaceLayerA.append({
          kind: 'lesson', text: 'always check ttl', source: 'user',
          ts: '2026-06-02T00:00:00Z',
        });
      } finally { await seed.dispose(); }
      const result = await fireBeforeAgentStart(api, 'q', 'BASE PROMPT');
      assert.match(result?.systemPrompt ?? '', /BASE PROMPT/);
      assert.match(result?.systemPrompt ?? '', /always check ttl/);
      await fireSessionShutdown(api);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });

  it('init failure notifies + gates commands', async () => {
    const api = makeFakeApi();
    coworkerMemoryExtension(api.api);
    process.env.OTTO_COWORKER_GLOBAL_DIR = '/no/such/path/should/not/exist';
    process.env.OTTO_SCRATCHPAD_ROOT = '/no/such/path/should/not/exist';
    try {
      await fireSessionStart(api, { cwd: '/no/such/path' });
      assert.ok(api.notifyCalls.find(c => /memory unavailable/.test(c.message)));
      const mem = api.commands.get('memory')!;
      await mem.handler('status', api.commandCtx);
      assert.ok(api.notifyCalls.filter(c => /unavailable/.test(c.message)).length >= 2);
    } finally {
      delete process.env.OTTO_COWORKER_GLOBAL_DIR;
      delete process.env.OTTO_SCRATCHPAD_ROOT;
    }
  });
});
