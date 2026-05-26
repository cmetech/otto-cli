/**
 * Regression test for #3674 — block direct writes to otto.db
 *
 * When otto_complete_task was unavailable, agents fell back to shell-based
 * sqlite3 writes, corrupting the WAL-backed database. The fix extends
 * write-intercept to block file writes and bash commands targeting otto.db.
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedStateFile, isBashWriteToStateFile } from '../write-intercept.ts';

describe('isBlockedStateFile blocks otto.db paths (#3674)', () => {
  test('blocks .otto/workflow/otto.db', () => {
    assert.ok(isBlockedStateFile('/project/.otto/workflow/otto.db'));
  });

  test('blocks .otto/workflow/otto.db-wal', () => {
    assert.ok(isBlockedStateFile('/project/.otto/workflow/otto.db-wal'));
  });

  test('blocks .otto/workflow/otto.db-shm', () => {
    assert.ok(isBlockedStateFile('/project/.otto/workflow/otto.db-shm'));
  });

  test('blocks resolved symlink path under .otto/workflow/projects/', () => {
    assert.ok(isBlockedStateFile('/home/user/.otto/workflow/projects/myproj/otto.db'));
  });

  test('still blocks STATE.md', () => {
    assert.ok(isBlockedStateFile('/project/.otto/workflow/STATE.md'));
  });

  test('does not block other .otto/workflow files', () => {
    assert.ok(!isBlockedStateFile('/project/.otto/workflow/DECISIONS.md'));
  });
});

describe('isBashWriteToStateFile blocks DB shell commands (#3674)', () => {
  test('blocks sqlite3 targeting otto.db', () => {
    assert.ok(isBashWriteToStateFile('sqlite3 .otto/workflow/otto.db "INSERT INTO ..."'));
  });

  test('blocks better-sqlite3 targeting otto.db', () => {
    assert.ok(isBashWriteToStateFile('node -e "require(\'better-sqlite3\')(\'.otto/workflow/otto.db\')"'));
  });

  test('blocks shell redirect to otto.db', () => {
    assert.ok(isBashWriteToStateFile('echo data > .otto/workflow/otto.db'));
  });

  test('blocks cp to otto.db', () => {
    assert.ok(isBashWriteToStateFile('cp backup.db .otto/workflow/otto.db'));
  });

  test('blocks mv to otto.db', () => {
    assert.ok(isBashWriteToStateFile('mv temp.db .otto/workflow/otto.db'));
  });

  test('does not block reading otto.db with cat', () => {
    assert.ok(!isBashWriteToStateFile('cat .otto/workflow/otto.db'));
  });
});
