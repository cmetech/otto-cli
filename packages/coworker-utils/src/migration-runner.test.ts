import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MigrationRunner } from './migration-runner.js';

describe('MigrationRunner', () => {
  let runner: MigrationRunner;

  beforeEach(() => {
    runner = new MigrationRunner();
  });

  it('no migrations registered → identity', async () => {
    const out = await runner.migrate('cells.jsonl', 1, { rows: [] });
    assert.deepEqual(out, { rows: [] });
  });

  it('runs a single registered migration v1 → v2', async () => {
    runner.register('cells.jsonl', 1, 2, async (data: any) => ({ ...data, kind: 'session' }));
    const out: any = await runner.migrate('cells.jsonl', 1, { foo: 'bar' });
    assert.equal(out.kind, 'session');
    assert.equal(out.foo, 'bar');
  });

  it('runs a chain of migrations in version order', async () => {
    runner.register('cells.jsonl', 1, 2, async (d: any) => ({ ...d, v2: true }));
    runner.register('cells.jsonl', 2, 3, async (d: any) => ({ ...d, v3: true }));
    const out: any = await runner.migrate('cells.jsonl', 1, {});
    assert.equal(out.v2, true);
    assert.equal(out.v3, true);
  });

  it('throws on missing migration in the chain', async () => {
    runner.register('cells.jsonl', 1, 2, async (d) => d);
    runner.register('cells.jsonl', 3, 4, async (d) => d);
    await assert.rejects(
      () => runner.migrate('cells.jsonl', 1, {}),
      /no migration from version 2 to 3/i,
    );
  });

  it('idempotent at current version', async () => {
    runner.register('cells.jsonl', 1, 2, async (d: any) => ({ ...d, ran: true }));
    const out: any = await runner.migrate('cells.jsonl', 2, { ran: false });
    assert.equal(out.ran, false, 'should not run migrations when already at latest');
  });

  it('different kinds have independent migration chains', async () => {
    runner.register('cells.jsonl', 1, 2, async (d: any) => ({ ...d, kind: 'cells' }));
    runner.register('layer-b.db', 1, 2, async (d: any) => ({ ...d, kind: 'layer-b' }));
    const cells: any = await runner.migrate('cells.jsonl', 1, {});
    const layerB: any = await runner.migrate('layer-b.db', 1, {});
    assert.equal(cells.kind, 'cells');
    assert.equal(layerB.kind, 'layer-b');
  });

  it('latestVersion returns highest registered target version', () => {
    runner.register('cells.jsonl', 1, 2, async (d) => d);
    runner.register('cells.jsonl', 2, 3, async (d) => d);
    assert.equal(runner.latestVersion('cells.jsonl'), 3);
  });

  it('latestVersion returns null for unknown kind', () => {
    assert.equal(runner.latestVersion('unknown'), null);
  });
});
