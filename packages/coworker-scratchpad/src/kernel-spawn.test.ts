import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { basename, isAbsolute } from 'node:path';
import { filterEnv, kernelExecArgv, resolveKernelEntry } from './kernel-spawn.js';

describe('filterEnv', () => {
  it('keeps allowlisted vars, allow-prefixed vars, and strips everything else', () => {
    const out = filterEnv({
      PATH: '/usr/bin',
      HOME: '/home/x',
      LC_ALL: 'en_US.UTF-8',
      OTTO_DS_servicenow_prod__token: 'injected',
      NODE_OPTIONS: '--max-old-space-size=512',
      RANDOM_THING: 'nope',
      ANTHROPIC_API_KEY: 'secret',
    });
    assert.equal(out.PATH, '/usr/bin');
    assert.equal(out.HOME, '/home/x');
    assert.equal(out.LC_ALL, 'en_US.UTF-8');
    assert.equal(out.OTTO_DS_servicenow_prod__token, 'injected');
    assert.equal(out.NODE_OPTIONS, '--max-old-space-size=512');
    assert.equal(out.RANDOM_THING, undefined);
    assert.equal(out.ANTHROPIC_API_KEY, undefined);
  });

  it('strips denylisted API keys even though no allow-rule would admit them', () => {
    const out = filterEnv({ OPENAI_API_KEY: 'x', LOOP24_GATEWAY_KEY: 'y' });
    assert.equal(out.OPENAI_API_KEY, undefined);
    assert.equal(out.LOOP24_GATEWAY_KEY, undefined);
  });
});

describe('kernelExecArgv', () => {
  it('forwards loader flags (with their values) and drops --test', () => {
    const out = kernelExecArgv([
      '--import',
      './src/resources/extensions/workflow/tests/resolve-ts.mjs',
      '--experimental-strip-types',
      '--test',
    ]);
    assert.deepEqual(out, [
      '--import',
      './src/resources/extensions/workflow/tests/resolve-ts.mjs',
      '--experimental-strip-types',
    ]);
  });

  it('handles --flag=value form and returns empty for a bare --test', () => {
    assert.deepEqual(kernelExecArgv(['--import=./x.mjs', '--test']), ['--import=./x.mjs']);
    assert.deepEqual(kernelExecArgv(['--test']), []);
  });
});

describe('resolveKernelEntry', () => {
  it('returns an absolute path to a kernel-entry module', () => {
    const entry = resolveKernelEntry();
    assert.equal(isAbsolute(entry), true);
    assert.ok(['kernel-entry.js', 'kernel-entry.ts'].includes(basename(entry)));
  });
});
