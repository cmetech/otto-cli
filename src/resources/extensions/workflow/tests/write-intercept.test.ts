// OTTO Extension — write-intercept unit tests
// Tests isBlockedStateFile() and BLOCKED_WRITE_ERROR constant.

import test from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedStateFile, BLOCKED_WRITE_ERROR } from '../write-intercept.ts';

// ─── isBlockedStateFile: blocked paths ───────────────────────────────────

test('write-intercept: blocks unix .otto/workflow/STATE.md path', () => {
  assert.strictEqual(isBlockedStateFile('/project/.otto/workflow/STATE.md'), true);
});

test('write-intercept: blocks relative path with dir prefix before .otto/workflow/STATE.md', () => {
  assert.strictEqual(isBlockedStateFile('project/.otto/workflow/STATE.md'), true);
});

test('write-intercept: blocks bare relative .otto/workflow/STATE.md (no leading separator)', () => {
  // (^|[/\\]) matches paths that start with .otto/workflow/ — covers the case where write
  // tools receive a bare relative path before the file exists (realpathSync fails).
  assert.strictEqual(isBlockedStateFile('.otto/workflow/STATE.md'), true);
});

test('write-intercept: blocks nested project .otto/workflow/STATE.md path', () => {
  assert.strictEqual(isBlockedStateFile('/Users/dev/my-project/.otto/workflow/STATE.md'), true);
});

test('write-intercept: blocks .otto/workflow/projects/<name>/STATE.md (symlinked projects path)', () => {
  assert.strictEqual(isBlockedStateFile('/home/user/.otto/workflow/projects/my-project/STATE.md'), true);
});

// ─── isBlockedStateFile: allowed paths ───────────────────────────────────

test('write-intercept: allows .otto/workflow/ROADMAP.md', () => {
  assert.strictEqual(isBlockedStateFile('/project/.otto/workflow/ROADMAP.md'), false);
});

test('write-intercept: allows .otto/workflow/PLAN.md', () => {
  assert.strictEqual(isBlockedStateFile('/project/.otto/workflow/PLAN.md'), false);
});

test('write-intercept: allows .otto/workflow/REQUIREMENTS.md', () => {
  assert.strictEqual(isBlockedStateFile('/project/.otto/workflow/REQUIREMENTS.md'), false);
});

test('write-intercept: allows .otto/workflow/SUMMARY.md', () => {
  assert.strictEqual(isBlockedStateFile('/project/.otto/workflow/SUMMARY.md'), false);
});

test('write-intercept: allows .otto/workflow/PROJECT.md', () => {
  assert.strictEqual(isBlockedStateFile('/project/.otto/workflow/PROJECT.md'), false);
});

test('write-intercept: allows regular source files', () => {
  assert.strictEqual(isBlockedStateFile('/project/src/index.ts'), false);
});

test('write-intercept: allows slice plan files', () => {
  assert.strictEqual(isBlockedStateFile('/project/.otto/workflow/milestones/M001/slices/S01/S01-PLAN.md'), false);
});

test('write-intercept: does not block files named STATE.md outside .otto/workflow/', () => {
  assert.strictEqual(isBlockedStateFile('/project/docs/STATE.md'), false);
});

// ─── BLOCKED_WRITE_ERROR: content ────────────────────────────────────────

test('write-intercept: BLOCKED_WRITE_ERROR is a non-empty string', () => {
  assert.strictEqual(typeof BLOCKED_WRITE_ERROR, 'string');
  assert.ok(BLOCKED_WRITE_ERROR.length > 0);
});

test('write-intercept: BLOCKED_WRITE_ERROR mentions engine tool calls', () => {
  assert.ok(BLOCKED_WRITE_ERROR.includes('otto_task_complete'), 'should mention otto_task_complete');
  assert.ok(BLOCKED_WRITE_ERROR.includes('engine tool calls'), 'should mention engine tool calls');
});
