// packages/coworker-artifacts/src/dir-snapshot.ts
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { DirSnapshot } from './types.js';

export function takeSnapshot(dir: string): DirSnapshot {
  const out: DirSnapshot = new Map();
  if (!existsSync(dir)) return out;
  walk(dir, dir, out);
  return out;
}

function walk(root: string, current: string, out: DirSnapshot): void {
  let entries;
  try { entries = readdirSync(current, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    const abs = join(current, entry.name);
    if (entry.isDirectory()) {
      walk(root, abs, out);
    } else if (entry.isFile()) {
      const stat = statSync(abs, { bigint: true });
      const rel = relative(root, abs).split(sep).join('/');
      out.set(rel, {
        mtimeNs: stat.mtimeNs,
        sizeBytes: Number(stat.size),
      });
    }
  }
}

export function diffSnapshots(
  before: DirSnapshot,
  after: DirSnapshot,
): { added: string[]; modified: string[]; removed: string[] } {
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  for (const [path, a] of after) {
    const b = before.get(path);
    if (!b) added.push(path);
    else if (b.mtimeNs !== a.mtimeNs || b.sizeBytes !== a.sizeBytes) modified.push(path);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) removed.push(path);
  }
  return {
    added: added.sort(),
    modified: modified.sort(),
    removed: removed.sort(),
  };
}
