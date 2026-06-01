import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface WorkspacePointer {
  schema_version: 1;
  workspace_hash: string;
  workspace_root: string;
  last_session_id: string;
  last_current_name: string;
  last_attached_at: string;
}

export const WORKSPACE_POINTER_STALE_MS = 7 * 24 * 60 * 60 * 1000;

export function workspaceHash(workspaceRoot: string): string {
  return createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 16);
}

export function workspacePointerPath(rootDir: string, hash: string): string {
  return join(rootDir, '_workspaces', `${hash}.json`);
}

export function readWorkspacePointer(path: string): WorkspacePointer | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<WorkspacePointer>;
    if (
      parsed.schema_version === 1 &&
      typeof parsed.workspace_hash === 'string' &&
      typeof parsed.workspace_root === 'string' &&
      typeof parsed.last_session_id === 'string' &&
      typeof parsed.last_current_name === 'string' &&
      typeof parsed.last_attached_at === 'string'
    ) {
      return parsed as WorkspacePointer;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeWorkspacePointer(path: string, payload: WorkspacePointer): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  renameSync(tmp, path);
}

export function isPointerFresh(pointer: WorkspacePointer, now: number): boolean {
  const attachedAt = Date.parse(pointer.last_attached_at);
  if (Number.isNaN(attachedAt)) return false;
  return (now - attachedAt) < WORKSPACE_POINTER_STALE_MS;
}
