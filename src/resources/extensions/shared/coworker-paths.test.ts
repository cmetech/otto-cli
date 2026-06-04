import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getCoworkerGlobalDir, getScratchpadsRoot } from './coworker-paths.js';

const ORIGINAL_GLOBAL = process.env.OTTO_COWORKER_GLOBAL_DIR;
const ORIGINAL_SCRATCH = process.env.OTTO_SCRATCHPAD_ROOT;

describe('coworker-paths', () => {
  before(() => {
    delete process.env.OTTO_COWORKER_GLOBAL_DIR;
    delete process.env.OTTO_SCRATCHPAD_ROOT;
  });
  after(() => {
    if (ORIGINAL_GLOBAL !== undefined) process.env.OTTO_COWORKER_GLOBAL_DIR = ORIGINAL_GLOBAL;
    else delete process.env.OTTO_COWORKER_GLOBAL_DIR;
    if (ORIGINAL_SCRATCH !== undefined) process.env.OTTO_SCRATCHPAD_ROOT = ORIGINAL_SCRATCH;
    else delete process.env.OTTO_SCRATCHPAD_ROOT;
  });

  it('getCoworkerGlobalDir defaults to ~/.otto', () => {
    delete process.env.OTTO_COWORKER_GLOBAL_DIR;
    assert.equal(getCoworkerGlobalDir(), join(homedir(), '.otto'));
  });
  it('getCoworkerGlobalDir respects OTTO_COWORKER_GLOBAL_DIR env', () => {
    process.env.OTTO_COWORKER_GLOBAL_DIR = '/tmp/otto-test';
    assert.equal(getCoworkerGlobalDir(), '/tmp/otto-test');
    delete process.env.OTTO_COWORKER_GLOBAL_DIR;
  });
  it('getScratchpadsRoot defaults to ~/.otto/scratchpads', () => {
    delete process.env.OTTO_SCRATCHPAD_ROOT;
    assert.equal(getScratchpadsRoot(), join(homedir(), '.otto', 'scratchpads'));
  });
  it('getScratchpadsRoot respects OTTO_SCRATCHPAD_ROOT env', () => {
    process.env.OTTO_SCRATCHPAD_ROOT = '/tmp/sp-test';
    assert.equal(getScratchpadsRoot(), '/tmp/sp-test');
    delete process.env.OTTO_SCRATCHPAD_ROOT;
  });
});
