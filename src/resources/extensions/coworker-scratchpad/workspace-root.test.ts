import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectWorkspaceRoot } from './workspace-root.js';

describe('detectWorkspaceRoot', () => {
  it('returns git toplevel when invoked inside a git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsr-git-'));
    try {
      execSync('git init -q', { cwd: dir });
      const sub = join(dir, 'a', 'b');
      mkdirSync(sub, { recursive: true });
      const root = detectWorkspaceRoot(sub);
      // On macOS, /tmp resolves through /private — compare resolved paths.
      assert.equal(
        execSync('pwd -P', { cwd: dir, encoding: 'utf8' }).trim(),
        execSync('pwd -P', { cwd: root, encoding: 'utf8' }).trim(),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns cwd when not in a git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsr-nogit-'));
    try {
      assert.equal(detectWorkspaceRoot(dir), dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns cwd when git command fails (mocked via PATH override)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsr-pathfail-'));
    try {
      // Run with PATH=/nonexistent so git isn't findable; detection should fall back to cwd.
      const origPath = process.env.PATH;
      process.env.PATH = '/nonexistent';
      try {
        assert.equal(detectWorkspaceRoot(dir), dir);
      } finally {
        process.env.PATH = origPath;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
