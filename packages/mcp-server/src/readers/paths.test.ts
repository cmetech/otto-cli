// GSD MCP Server — .otto/workflow/ path cache tests

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  _resetReaderCaches,
  findMilestoneIds,
  findSliceIds,
  findTaskFiles,
} from './paths.js';

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

function writeFixture(base: string, relPath: string, content: string): void {
  const full = join(base, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

describe('reader path caches', () => {
  beforeEach(() => {
    _resetReaderCaches();
  });

  it('returns defensive copies of cached milestone and slice ids', () => {
    const tmp = makeTempDir('gsd-path-cache');
    try {
      const workflowRoot = join(tmp, '.otto', 'workflow');
      mkdirSync(join(workflowRoot, 'milestones', 'M001', 'slices', 'S01'), { recursive: true });
      mkdirSync(join(workflowRoot, 'milestones', 'M002'), { recursive: true });

      const milestoneIds = findMilestoneIds(workflowRoot);
      milestoneIds.push('M999');
      assert.deepEqual(findMilestoneIds(workflowRoot), ['M001', 'M002']);

      const sliceIds = findSliceIds(workflowRoot, 'M001');
      sliceIds.push('S99');
      assert.deepEqual(findSliceIds(workflowRoot, 'M001'), ['S01']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns defensive copies of cached task file objects', () => {
    const tmp = makeTempDir('gsd-path-task-cache');
    try {
      const workflowRoot = join(tmp, '.otto', 'workflow');
      writeFixture(workflowRoot, 'milestones/M001/slices/S01/tasks/T01-PLAN.md', '# T01');

      const taskFiles = findTaskFiles(workflowRoot, 'M001', 'S01');
      taskFiles[0].hasSummary = true;
      taskFiles.push({ id: 'T99', hasPlan: true, hasSummary: true });

      assert.deepEqual(findTaskFiles(workflowRoot, 'M001', 'S01'), [
        { id: 'T01', hasPlan: true, hasSummary: false },
      ]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
