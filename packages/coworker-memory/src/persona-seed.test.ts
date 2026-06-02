// packages/coworker-memory/src/persona-seed.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog, SecretScanner } from '@otto/coworker-utils';
import { LayerAStore } from './layer-a-store.js';
import { applyPersonaSeed } from './persona-seed.js';

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ps-'));
  const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
  const scanner = new SecretScanner();
  const scopeDir = join(root, 'memory');
  const personaDir = join(root, 'persona-noc');
  const seedDir = join(personaDir, 'memory-seed');
  mkdirSync(seedDir, { recursive: true });
  const store = new LayerAStore({ scopeDir, scope: 'workspace', audit, scanner });
  return { root, audit, store, personaDir, seedDir };
}

describe('applyPersonaSeed', () => {
  it('copies profile.md/rules.md/lessons.md from persona memory-seed', async () => {
    const c = setup();
    writeFileSync(join(c.seedDir, 'profile.md'), 'Persona NOC profile baseline.');
    writeFileSync(join(c.seedDir, 'rules.md'), 'Always escalate P1 to mgr.');
    writeFileSync(join(c.seedDir, 'lessons.md'), 'Datadog API uses pagination.');
    const out = await applyPersonaSeed({
      personaId: 'noc-ops', personaDir: c.personaDir, store: c.store,
    });
    assert.deepEqual(out.copied.sort(), ['lessons.md', 'profile.md', 'rules.md']);
    assert.match(await c.store.read('profile'), /Persona NOC profile baseline/);
    assert.match(await c.store.read('rule'), /Always escalate P1 to mgr/);
    assert.match(await c.store.read('lesson'), /Datadog API uses pagination/);
  });
  it('blocks files containing secrets but copies remaining', async () => {
    const c = setup();
    writeFileSync(join(c.seedDir, 'profile.md'), 'Persona baseline.');
    writeFileSync(join(c.seedDir, 'rules.md'), 'use AKIAABCDEFGHIJKLMNOP for telemetry');
    const out = await applyPersonaSeed({
      personaId: 'noc-ops', personaDir: c.personaDir, store: c.store,
    });
    assert.deepEqual(out.copied, ['profile.md']);
    assert.deepEqual(out.blocked, ['rules.md']);
    assert.equal(await c.store.read('rule'), '');
  });
  it('returns empty result when persona has no memory-seed dir', async () => {
    const c = setup();
    // No files written; remove seedDir
    const out = await applyPersonaSeed({
      personaId: 'plain', personaDir: join(c.root, 'no-such-persona'), store: c.store,
    });
    assert.deepEqual(out.copied, []);
    assert.deepEqual(out.blocked, []);
  });
});
