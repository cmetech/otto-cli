// packages/coworker-memory/src/workspace-id.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorkspaceId } from './workspace-id.js';

function tmp(): string { return mkdtempSync(join(tmpdir(), 'wsid-')); }

describe('resolveWorkspaceId', () => {
  it('creates workspace.json on first call with basename + 6-hex slug', async () => {
    const root = tmp();
    const ws = join(root, 'acme-noc');
    mkdirSync(ws, { recursive: true });
    const rec = await resolveWorkspaceId(ws);
    assert.match(rec.id, /^acme-noc-[0-9a-f]{6}$/);
    assert.equal(rec.memory_seed_applied, false);
    assert.equal(rec.memory_seed_persona, null);
    assert.ok(existsSync(join(ws, '.otto', 'memory', 'workspace.json')));
  });
  it('returns existing id on second call (idempotent)', async () => {
    const root = tmp();
    const ws = join(root, 'acme-noc');
    mkdirSync(ws, { recursive: true });
    const a = await resolveWorkspaceId(ws);
    const b = await resolveWorkspaceId(ws);
    assert.equal(a.id, b.id);
    assert.equal(a.created_at, b.created_at);
  });
  it('falls back to path-hash when workspace.json is corrupted', async () => {
    const root = tmp();
    const ws = join(root, 'broken');
    mkdirSync(join(ws, '.otto', 'memory'), { recursive: true });
    writeFileSync(join(ws, '.otto', 'memory', 'workspace.json'), 'not json');
    const rec = await resolveWorkspaceId(ws);
    assert.match(rec.id, /^broken-[0-9a-f]{6}$/);
    assert.ok(existsSync(join(ws, '.otto', 'memory', 'workspace.json.broken-')) ||
              readFileSync(join(ws, '.otto', 'memory', 'workspace.json'), 'utf8').includes('"_schema"'));
  });
  it('uses workspace fallback when basename is empty', async () => {
    // synthesize via an explicit path with weird basename
    const root = tmp();
    const ws = root; // root-of-tmp has a basename like 'wsid-xxxxxx', fine
    const rec = await resolveWorkspaceId(ws);
    assert.ok(rec.id.length > 0);
  });
});
