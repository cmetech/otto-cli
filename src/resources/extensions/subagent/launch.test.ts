// src/resources/extensions/subagent/launch.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShellEnvAssignments,
  buildSubagentProcessEnv,
  createSubagentLaunchPlan,
  mintSubagentScratchpadName,
  SUBAGENT_CHILD_ENV_VAR,
  SUBAGENT_SCRATCHPAD_ENV_VAR,
} from './launch.js';
import type { AgentConfig } from './agents.js';

const STUB_AGENT: AgentConfig = {
  name: 'rca-analyst',
  description: '',
  systemPrompt: 'x',
  source: 'project',
  filePath: '/tmp/rca-analyst.md',
};

describe('mintSubagentScratchpadName', () => {
  it('produces subagent-<agent>-<6hex> for simple input', () => {
    const name = mintSubagentScratchpadName('rca-analyst');
    assert.match(name, /^subagent-rca-analyst-[0-9a-f]{6}$/);
  });
  it('sanitizes uppercase + punctuation to kebab', () => {
    const name = mintSubagentScratchpadName('UPPER & weird!! chars');
    assert.match(name, /^subagent-upper-weird-chars-[0-9a-f]{6}$/);
  });
  it('falls back to subagent-<hex> for empty input', () => {
    const name = mintSubagentScratchpadName('');
    assert.match(name, /^subagent-[0-9a-f]{6}$/);
  });
  it('truncates agent portion to fit reasonable length', () => {
    const long = 'a'.repeat(100);
    const name = mintSubagentScratchpadName(long);
    // subagent- (9) + max 32 chars agent + - + 6 hex = max 48
    assert.ok(name.length <= 48);
    assert.match(name, /^subagent-a+-[0-9a-f]{6}$/);
  });
  it('strips diacritics', () => {
    const name = mintSubagentScratchpadName('résumé');
    assert.match(name, /^subagent-resume-[0-9a-f]{6}$/);
  });
});

describe('buildSubagentProcessEnv', () => {
  it('without scratchpad name preserves existing OTTO_SUBAGENT_CHILD only', () => {
    const env = buildSubagentProcessEnv({ FOO: 'bar' });
    assert.equal(env[SUBAGENT_CHILD_ENV_VAR], '1');
    assert.equal(env.FOO, 'bar');
    assert.equal(env[SUBAGENT_SCRATCHPAD_ENV_VAR], undefined);
  });
  it('with scratchpad name injects OTTO_SUBAGENT_SCRATCHPAD', () => {
    const env = buildSubagentProcessEnv({ FOO: 'bar' }, 'subagent-foo-abc123');
    assert.equal(env[SUBAGENT_CHILD_ENV_VAR], '1');
    assert.equal(env[SUBAGENT_SCRATCHPAD_ENV_VAR], 'subagent-foo-abc123');
  });
});

describe('buildShellEnvAssignments', () => {
  it('includes scratchpad assignment when var is set', () => {
    const out = buildShellEnvAssignments({
      [SUBAGENT_CHILD_ENV_VAR]: '1',
      [SUBAGENT_SCRATCHPAD_ENV_VAR]: 'subagent-foo-abc123',
    });
    assert.ok(out.some((s) => s.startsWith(`${SUBAGENT_CHILD_ENV_VAR}=`)));
    assert.ok(out.some((s) => s.startsWith(`${SUBAGENT_SCRATCHPAD_ENV_VAR}=`)));
  });
  it('omits scratchpad assignment when var is unset', () => {
    const out = buildShellEnvAssignments({ [SUBAGENT_CHILD_ENV_VAR]: '1' });
    assert.equal(out.some((s) => s.startsWith(`${SUBAGENT_SCRATCHPAD_ENV_VAR}=`)), false);
  });
});

describe('createSubagentLaunchPlan', () => {
  it('threads scratchpadName into env', () => {
    const plan = createSubagentLaunchPlan({
      agent: STUB_AGENT,
      task: 'do thing',
      tmpPromptPath: null,
      defaultCwd: '/tmp',
      scratchpadName: 'subagent-rca-analyst-abc123',
    });
    assert.equal(plan.env[SUBAGENT_SCRATCHPAD_ENV_VAR], 'subagent-rca-analyst-abc123');
  });
  it('without scratchpadName leaves env var unset', () => {
    const plan = createSubagentLaunchPlan({
      agent: STUB_AGENT,
      task: 'do thing',
      tmpPromptPath: null,
      defaultCwd: '/tmp',
    });
    assert.equal(plan.env[SUBAGENT_SCRATCHPAD_ENV_VAR], undefined);
  });
});
