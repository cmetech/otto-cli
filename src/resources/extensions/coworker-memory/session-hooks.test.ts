// src/resources/extensions/coworker-memory/session-hooks.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryBundle } from './memory-singleton.js';
import { onSessionStart, onSessionShutdown } from './session-hooks.js';

async function setup() {
  const home = mkdtempSync(join(tmpdir(), 'sh-home-'));
  const ws = mkdtempSync(join(tmpdir(), 'sh-ws-'));
  mkdirSync(ws, { recursive: true });
  return {
    home,
    ws,
    bundle: await createMemoryBundle({
      globalDir: home,
      workspaceDir: ws,
      scopeMode: 'per-project-tagged',
      currentScratchpadName: () => null,
    }),
  };
}

describe('session hooks', () => {
  it('onSessionStart returns Layer A context block', async () => {
    const c = await setup();
    await c.bundle.workspaceLayerA.append({
      kind: 'lesson',
      text: 'do not deploy on friday',
      source: 'user',
      ts: '2026-06-02T00:00:00Z',
    });
    const out = await onSessionStart(c.bundle, { tokenLimit: 3000 });
    assert.match(out.contextBlock, /Memory \(Layer A\)/);
    assert.match(out.contextBlock, /do not deploy on friday/);
    await c.bundle.dispose();
  });
  it('onSessionStart applies persona seed when pending', async () => {
    const c = await setup();
    const personaDir = mkdtempSync(join(tmpdir(), 'persona-'));
    const seedDir = join(personaDir, 'memory-seed');
    mkdirSync(seedDir, { recursive: true });
    writeFileSync(join(seedDir, 'rules.md'), 'Persona rule baseline');
    const out = await onSessionStart(c.bundle, {
      tokenLimit: 3000,
      persona: { id: 'noc-ops', personaDir },
    });
    assert.deepEqual(out.seed.copied, ['rules.md']);
    assert.equal(c.bundle.workspaceRecord.memory_seed_applied, true);
    assert.equal(c.bundle.workspaceRecord.memory_seed_persona, 'noc-ops');
    await c.bundle.dispose();
  });
  it('onSessionStart does not re-apply seed once flag is true', async () => {
    const c = await setup();
    const personaDir = mkdtempSync(join(tmpdir(), 'persona2-'));
    const seedDir = join(personaDir, 'memory-seed');
    mkdirSync(seedDir, { recursive: true });
    writeFileSync(join(seedDir, 'rules.md'), 'Persona rule v1');
    await onSessionStart(c.bundle, { tokenLimit: 3000, persona: { id: 'noc-ops', personaDir } });
    // Now change the seed file but the flag is set.
    writeFileSync(join(seedDir, 'rules.md'), 'Persona rule v2');
    const second = await onSessionStart(c.bundle, {
      tokenLimit: 3000,
      persona: { id: 'noc-ops', personaDir },
    });
    assert.deepEqual(second.seed.copied, []);
    await c.bundle.dispose();
  });
  it('onSessionShutdown closes backend without throwing', async () => {
    const c = await setup();
    await onSessionShutdown(c.bundle);
    // Bundle is now disposed; second close should be safe.
    await c.bundle.dispose();
  });
});
