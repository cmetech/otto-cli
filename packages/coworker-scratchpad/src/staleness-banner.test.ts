import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StalenessBanner } from './staleness-banner.js';

describe('StalenessBanner', () => {
  const lookup = (refToTs: Record<string, string>) => async (ref: string) => refToTs[ref] ?? null;

  it('returns null when no binding is stale', async () => {
    const sb = new StalenessBanner();
    const banner = await sb.check({
      scratchpadName: 'sp', sessionId: 's',
      bindings: ['jira:prod'], spawnTime: new Date('2026-06-01T00:01:00.000Z'),
      lookupLastModified: lookup({ 'jira:prod': '2026-06-01T00:00:00.000Z' }),
    });
    assert.equal(banner, null);
  });

  it('returns banner string when a binding was modified after spawnTime', async () => {
    const sb = new StalenessBanner();
    const banner = await sb.check({
      scratchpadName: 'sp', sessionId: 's',
      bindings: ['jira:prod'], spawnTime: new Date('2026-06-01T00:00:00.000Z'),
      lookupLastModified: lookup({ 'jira:prod': '2026-06-01T00:05:00.000Z' }),
    });
    assert.ok(banner);
    assert.match(banner, /jira:prod/);
    assert.match(banner, /\/sp reset/);
  });

  it('returns null on the second check for the same (scratchpad, binding, session)', async () => {
    const sb = new StalenessBanner();
    const args = {
      scratchpadName: 'sp', sessionId: 's',
      bindings: ['jira:prod'], spawnTime: new Date('2026-06-01T00:00:00.000Z'),
      lookupLastModified: lookup({ 'jira:prod': '2026-06-01T00:05:00.000Z' }),
    };
    assert.ok(await sb.check(args));
    assert.equal(await sb.check(args), null);
  });

  it('re-fires after spawnTime advances (kernel respawn)', async () => {
    const sb = new StalenessBanner();
    const base = {
      scratchpadName: 'sp', sessionId: 's', bindings: ['jira:prod'],
      lookupLastModified: lookup({ 'jira:prod': '2026-06-01T00:05:00.000Z' }),
    };
    await sb.check({ ...base, spawnTime: new Date('2026-06-01T00:00:00.000Z') }); // shown once
    await sb.check({ ...base, spawnTime: new Date('2026-06-01T00:00:00.000Z') }); // suppressed
    sb.resetForRespawn('sp');
    const banner = await sb.check({ ...base, spawnTime: new Date('2026-06-01T00:10:00.000Z') });
    assert.equal(banner, null);  // post-respawn lastModified < new spawnTime
  });
});
