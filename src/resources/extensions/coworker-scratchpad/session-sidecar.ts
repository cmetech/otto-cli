import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SessionSidecar {
  schema_version: 1;
  session_id: string;
  current_name: string;
  attached_at: string;
}

export function sessionSidecarPath(rootDir: string, sessionId: string): string {
  return join(rootDir, '_sessions', `${sessionId}.json`);
}

export function readSessionSidecar(path: string): SessionSidecar | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SessionSidecar>;
    if (
      parsed.schema_version === 1 &&
      typeof parsed.session_id === 'string' &&
      typeof parsed.current_name === 'string' &&
      typeof parsed.attached_at === 'string'
    ) {
      return parsed as SessionSidecar;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSessionSidecar(path: string, payload: SessionSidecar): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2));
  renameSync(tmp, path);
}

export function deleteSessionSidecar(path: string): void {
  rmSync(path, { force: true });
}
