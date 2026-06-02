/**
 * Project/App: OTTO
 * File Purpose: End-to-end integration test for vault + scratchpad (Phase 2 Task 17).
 *
 * Exercises the four contract seams of the otto-vault pillar working together:
 *   1. bindings → CredentialInjector → ChildProcessRuntime env → live cell
 *   2. SecretScanner redaction on the journal copy of stdout (live result intact)
 *   3. vault rotation produces a StalenessBanner hit on the next staleness check
 *   4. workspace vault entry shadows global vault entry
 *
 * Uses ScratchpadManager + ChildProcessRuntime + LocalDataVault + CredentialInjector
 * end-to-end (no stubs on the integration boundary). Tests 1–3 spawn a real kernel
 * subprocess; test 4 is vault-only and does not spawn.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from '@otto/coworker-utils';
import { CredentialInjector, LocalDataVault } from '@otto/coworker-vault';
import { ScratchpadManager } from './scratchpad-manager.js';
import { StalenessBanner } from './staleness-banner.js';

interface E2EContext {
  root: string;
  audit: AuditLog;
  vault: LocalDataVault;
  injector: CredentialInjector;
  manager: ScratchpadManager;
  scratchpadsRoot: string;
}

async function setup(): Promise<E2EContext> {
  const root = mkdtempSync(join(tmpdir(), 'vault-e2e-'));
  await mkdir(join(root, 'home'), { recursive: true });
  await mkdir(join(root, 'workspace', '.otto', 'inputs'), { recursive: true });
  const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
  const vault = new LocalDataVault({
    globalDir: join(root, 'home'),
    workspaceDir: undefined,
    audit,
  });
  const injector = new CredentialInjector({ vault, audit });
  await vault.set(
    { engine: 'jira', name: 'prod' },
    { url: 'https://x', email: 'a@b', token: 'tok' },
  );
  const scratchpadsRoot = join(root, 'scratchpads');
  const manager = new ScratchpadManager({
    workspace: join(root, 'workspace'),
    root: scratchpadsRoot,
    injector,
    audit,
    sessionId: 'sess-1',
    // Keep the kernel responsive even under slow test machines.
    runtimeOptions: { cellTimeoutMs: 30_000, inactivityTimeoutMs: 30_000 },
  });
  return { root, audit, vault, injector, manager, scratchpadsRoot };
}

async function teardown(ctx: E2EContext): Promise<void> {
  await ctx.manager.disposeAll();
  rmSync(ctx.root, { recursive: true, force: true });
}

async function readAuditRecords(audit: AuditLog): Promise<Array<{
  producer: string; action: string; detail: Record<string, unknown>;
}>> {
  const out: Array<{ producer: string; action: string; detail: Record<string, unknown> }> = [];
  for await (const r of audit.read({})) {
    out.push({ producer: r.producer, action: r.action, detail: r.detail });
  }
  return out;
}

describe('vault + scratchpad end-to-end (Phase 2 Task 17)', () => {
  // Hold contexts so a test-level failure still cleans up.
  const contexts: E2EContext[] = [];
  after(async () => {
    for (const c of contexts) {
      try { await teardown(c); } catch { /* best effort */ }
    }
  });

  it('Test 1: --use binding injects OTTO_DS_* into kernel; cell reads it', async () => {
    const ctx = await setup();
    contexts.push(ctx);
    await ctx.manager.create('p1', { bindings: ['jira:prod'] });
    const rt = await ctx.manager.getOrAttach('p1');
    const { value } = await rt.runCell(
      'return [process.env.OTTO_DS_JIRA_PROD__URL, process.env.OTTO_DS_JIRA_PROD__TOKEN];',
    );
    assert.deepEqual(value, ['https://x', 'tok']);
    // The parent process must not be polluted by the injection.
    assert.equal(process.env.OTTO_DS_JIRA_PROD__URL, undefined);
    assert.equal(process.env.OTTO_DS_JIRA_PROD__TOKEN, undefined);
  });

  it('Test 2: secret printed by cell is redacted in the journal but live result preserved', async () => {
    const ctx = await setup();
    contexts.push(ctx);
    await ctx.manager.create('p2', { bindings: ['jira:prod'] });
    // Run via the manager so the SecretScanner gate runs on the journal copy.
    // AKIAABCDEFGHIJKLMNOP = AKIA + 16 alphanumeric => matches aws_access_key_id.
    const result = await ctx.manager.runCell(
      'p2',
      'console.log("leaked AKIAABCDEFGHIJKLMNOP"); return 1;',
    );
    assert.equal(result.value, 1);
    // Live stdout: redaction is journal-only, so the manager's returned stdout
    // should still contain the raw secret string.
    assert.ok(
      result.stdout.includes('AKIAABCDEFGHIJKLMNOP'),
      `live stdout should preserve real secret; got: ${JSON.stringify(result.stdout)}`,
    );

    // Journal: cells.jsonl's stdout field is the journal copy and must be redacted.
    // NOTE: the cell's `code` field intentionally preserves the original source for
    // reproducibility — redaction only covers stdout + error.message per Task 14's
    // contract. The raw secret string therefore can appear in the `code` field;
    // we explicitly assert against the `stdout` field by parsing the record.
    const cellsPath = join(ctx.scratchpadsRoot, 'p2', 'cells.jsonl');
    const cellsLines = readFileSync(cellsPath, 'utf8')
      .split('\n')
      .filter((l) => l.includes('"id"'));
    assert.equal(cellsLines.length, 1, `expected exactly one cell record; got ${cellsLines.length}`);
    const journalEntry = JSON.parse(cellsLines[0]!) as { stdout: string; code: string };
    assert.ok(
      journalEntry.stdout.includes('[REDACTED:aws_access_key_id]'),
      `journal stdout should contain redaction marker; got: ${journalEntry.stdout}`,
    );
    assert.ok(
      !journalEntry.stdout.includes('AKIAABCDEFGHIJKLMNOP'),
      `journal stdout should NOT contain raw secret; got: ${journalEntry.stdout}`,
    );

    // Audit: at least one secret-scanner record should land in the shared audit.
    const records = await readAuditRecords(ctx.audit);
    const scan = records.filter((r) => r.producer === 'secret-scanner' && r.action === 'redact');
    assert.ok(
      scan.length >= 1,
      `expected >=1 secret-scanner audit record; got ${scan.length} (records=${JSON.stringify(records)})`,
    );
    assert.equal(scan[0]!.detail.kind, 'aws_access_key_id');
  });

  it('Test 3: vault entry rotation triggers staleness banner on next check', async () => {
    const ctx = await setup();
    contexts.push(ctx);
    await ctx.manager.create('p3', { bindings: ['jira:prod'] });
    const rt = await ctx.manager.getOrAttach('p3');

    // First cell — establishes a normal pre-rotation baseline.
    const before = await rt.runCell('return 1;');
    assert.equal(before.value, 1);

    // No staleness yet — banner should be null.
    const banner = new StalenessBanner();
    const preCheck = await banner.check({
      scratchpadName: 'p3',
      sessionId: 'sess-1',
      bindings: ['jira:prod'],
      spawnTime: rt.spawnTime,
      lookupLastModified: (ref) => ctx.vault.lookupLastModified(ref),
    });
    assert.equal(preCheck, null, `expected no banner before rotation; got: ${preCheck}`);

    // Wait so last_modified_at advances past the recorded spawnTime.
    await new Promise((r) => setTimeout(r, 25));

    // Rotate the vault entry — bumps last_modified_at.
    await ctx.vault.set(
      { engine: 'jira', name: 'prod' },
      { url: 'NEW', email: 'a@b', token: 'tok' },
    );

    const postCheck = await banner.check({
      scratchpadName: 'p3',
      sessionId: 'sess-1',
      bindings: ['jira:prod'],
      spawnTime: rt.spawnTime,
      lookupLastModified: (ref) => ctx.vault.lookupLastModified(ref),
    });
    assert.ok(postCheck, `expected a staleness banner string after rotation; got null`);
    assert.match(postCheck!, /jira:prod/);
    assert.match(postCheck!, /\/sp reset/);
  });

  it('Test 4: workspace vault entry shadows global', async () => {
    // Dedicated vault root with both global + workspace dirs (does not use setup()).
    const root = mkdtempSync(join(tmpdir(), 'vault-e2e-shadow-'));
    try {
      const audit = new AuditLog({ path: join(root, 'audit.jsonl') });
      const globalDir = join(root, 'home');
      const workspaceDir = join(root, 'workspace');
      const vault = new LocalDataVault({ globalDir, workspaceDir, audit });

      // Write global entry first.
      await vault.set(
        { engine: 'jira', name: 'prod' },
        { url: 'https://global', email: 'g@x', token: 'tok-global' },
      );

      // Write workspace entry second via forceWorkspace.
      await vault.set(
        { engine: 'jira', name: 'prod' },
        { url: 'https://workspace', email: 'w@x', token: 'tok-workspace' },
        { forceWorkspace: true },
      );

      // get() should resolve workspace first.
      const got = await vault.get({ engine: 'jira', name: 'prod' });
      assert.equal(got.fields.url, 'https://workspace');
      assert.equal(got.fields.token, 'tok-workspace');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
