// packages/coworker-memory/src/workspace-id.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import type { WorkspaceIdRecord } from './types.js';

function pathHash6(absolutePath: string): string {
  return createHash('sha256').update(absolutePath).digest('hex').slice(0, 6);
}

function deriveSlug(workspaceDir: string): string {
  let base = basename(workspaceDir).replace(/[^a-z0-9-]/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  if (!base) base = 'workspace';
  return `${base}-${pathHash6(workspaceDir)}`;
}

export async function resolveWorkspaceId(workspaceDir: string): Promise<WorkspaceIdRecord> {
  const memDir = join(workspaceDir, '.otto', 'memory');
  const path = join(memDir, 'workspace.json');
  mkdirSync(memDir, { recursive: true, mode: 0o700 });

  if (existsSync(path)) {
    try {
      const data = JSON.parse(readFileSync(path, 'utf8')) as WorkspaceIdRecord;
      if (data && data._schema === 1 && typeof data.id === 'string' && data.id.length > 0) {
        return data;
      }
    } catch { /* fall through to recreate */ }
    // Move broken aside.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try { renameSync(path, `${path}.broken-${stamp}`); } catch { /* best effort */ }
  }

  const fresh: WorkspaceIdRecord = {
    _schema: 1,
    id: deriveSlug(workspaceDir),
    created_at: new Date().toISOString(),
    memory_seed_applied: false,
    memory_seed_persona: null,
  };
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  return fresh;
}

export async function writeWorkspaceId(workspaceDir: string, rec: WorkspaceIdRecord): Promise<void> {
  const memDir = join(workspaceDir, '.otto', 'memory');
  mkdirSync(memDir, { recursive: true, mode: 0o700 });
  const path = join(memDir, 'workspace.json');
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(rec, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}
